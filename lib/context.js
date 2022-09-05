const _ = Symbol('private');

class ContextFacade {
  constructor(context) {
    this[_] = context;
    if (context.facade) {
      throw new Error('A context can have only one facade');
    }
    context.facade = this;
  }

  get options() {
    return this[_].options;
  }

  get generators() {
    return this[_].generators;
  }

  get matchNodesByRef() {
    return this[_].matchNodesByRef;
  }
}

class Context {
  constructor(grammar, options = {}) {
    this.options = options;
    this.generators = grammar.generators;
    this.isHoistable = grammar.isHoistable || (() => false);
    this.matchNodesByRef = new WeakMap();

    this.facade = new ContextFacade(this);
  }
}

module.exports = { Context };