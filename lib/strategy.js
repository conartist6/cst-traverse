import size from 'iter-tools-es/methods/size';
import { Coroutine } from '@bablr/coroutine';
import {
  buildCall,
  buildReference,
  buildNull,
  buildEmbeddedTag,
} from '@bablr/agast-helpers/builders';
import { StreamGenerator } from '@bablr/agast-helpers/stream';
import { getOpenTag } from '@bablr/agast-helpers/tree';
import { buildTokens } from './utils/token.js';
import { formatType } from './utils/format.js';
import { facades } from './facades.js';
import { State } from './state.js';
import { updateSpans } from './spans.js';

const { hasOwn } = Object;

export const createBablrStrategy = (rootSource, strategy) => {
  return (ctx, agastState) => {
    return new StreamGenerator(__strategy(ctx, rootSource, agastState, strategy));
  };
};

const resolvedLanguages = new WeakMap();

const __strategy = function* bablrStrategy(ctx, rootSource, agastState, strategy) {
  let s = State.from(rootSource, agastState);

  let co = new Coroutine(strategy(facades.get(s), ctx));

  co.advance();

  {
    s.source.advance();

    const sourceStep = s.source.fork.head.step;

    if (sourceStep instanceof Promise) {
      yield sourceStep;
    }
  }

  for (;;) {
    if (co.current instanceof Promise) {
      co.current = yield co.current;
    }

    if (co.done) break;

    const instr = co.value;
    let returnValue = undefined;

    const { verb } = instr;

    switch (verb) {
      case 'advance': {
        const { arguments: { 0: embeddedTerminal } = [] } = instr;

        const terminal = embeddedTerminal.value;

        switch (terminal?.type || 'Null') {
          case 'DoctypeTag': {
            const doctypeTag = yield instr;

            returnValue = doctypeTag;
            break;
          }

          case 'OpenNodeTag': {
            const { type } = terminal.value;

            const openTag = yield instr;

            if (type) {
              updateSpans(ctx, s, s.node, 'open');
            }

            returnValue = openTag;
            break;
          }

          case 'CloseNodeTag': {
            const { node } = s;

            const endTag = yield instr;

            if (s.path) {
              updateSpans(ctx, s, node, 'close');
            } else {
              if (!s.source.done) {
                throw new Error('Parser failed to consume input');
              }

              if (s.balanced.size) {
                throw new Error('Parser did not match all balanced nodes');
              }
            }

            returnValue = endTag;
            break;
          }

          case 'Literal': {
            const { value: pattern } = terminal;

            let result = s.guardedMatch(pattern);

            if (result instanceof Promise) {
              result = yield result;
            }

            if (result) {
              let sourceStep = s.source.advance(size(result));

              if (sourceStep instanceof Promise) {
                sourceStep = yield sourceStep;
              }

              returnValue = yield instr;
            } else {
              throw new Error('Failed to advance literal');
            }
            break;
          }

          case 'Gap': {
            if (s.source.value == null && !s.source.done) {
              if (s.source.holding) {
                s.source.unshift();
              } else {
                const sourceStep = s.source.advance(1);

                if (sourceStep instanceof Promise) {
                  yield sourceStep;
                }
              }

              returnValue = yield instr;
            } else {
              throw new Error('Failed to advance gap');
            }
            break;
          }

          case 'Shift': {
            s.source.shift();

            returnValue = yield instr;
            break;
          }

          default: {
            returnValue = yield instr;
            break;
          }
        }

        break;
      }

      case 'match': {
        let { arguments: { 0: pattern } = [] } = instr;

        let result = s.guardedMatch(pattern);

        if (result instanceof Promise) {
          result = yield result;
        }

        const tokens = result && ctx.buildRange(buildTokens(result));

        returnValue = tokens || null;
        break;
      }

      case 'branch': {
        const baseState = s;
        let { source, agast, balanced, spans, node } = baseState;

        agast = yield instr;

        s = s.push(source.branch(), agast, balanced, spans);

        if (node) {
          resolvedLanguages.set(s.node, resolvedLanguages.get(node));
        }

        returnValue = facades.get(s);
        break;
      }

      case 'accept': {
        const accepted = s;

        s.status = 'accepted';

        const agastState = yield instr;

        s = s.parent;

        if (!s) {
          throw new Error('accepted the root state');
        }

        s.spans = accepted.spans;
        s.balanced = accepted.balanced;

        s.source.accept(accepted.source);
        s.agast = agastState;

        returnValue = facades.get(s);
        break;
      }

      case 'reject': {
        const rejectedState = s;

        s.status = 'rejected';

        yield instr;

        s = s.parent;

        if (s.path.depth && rejectedState.path.depth > s.path.depth) {
          // const didShift = rejectedState.node.at(sNodeDepth) === s.node;
          const didShift =
            s.nodeForPath(s.path) && !s.nodeForPath(rejectedState.path.at(s.path.depth));
          const lowPath = rejectedState.path.at(
            Math.min(
              s.path.depth + (didShift || s.result.type === 'Reference' ? 0 : 1),
              rejectedState.path.depth,
            ),
          );
          const lowNode = s.node || s.parentNode;

          const { name, isArray } = lowPath.reference?.value || {};

          if (
            !didShift &&
            !hasOwn(lowNode.properties, name) &&
            !(s.result.type === 'Reference' && s.result.value.name === name)
          ) {
            if (
              !getOpenTag(lowNode)?.value.flags.trivia &&
              !getOpenTag(lowNode)?.value.flags.escape
            ) {
              yield buildCall('advance', buildEmbeddedTag(buildReference(name, isArray)));
            }

            yield buildCall('advance', buildEmbeddedTag(buildNull()));
          }
        }

        if (!s) throw new Error('rejected root state');

        rejectedState.source.reject();

        returnValue = facades.get(s);
        break;
      }

      case 'write':
      case 'bindAttribute': {
        returnValue = yield instr;
        break;
      }

      case 'getState': {
        returnValue = facades.get(s);
        break;
      }

      default: {
        throw new Error(`Unexpected call of {type: ${formatType(verb)}}`);
      }
    }

    co.advance(returnValue);
  }
};