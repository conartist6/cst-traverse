const indent = (state, text = '') => {
  let str = '      ';

  let s = state;
  while (s.parent && s.path === s.parent.path) {
    str += '  ';
    s = s.parent;
  }

  return str + text;
};

const indentModule = (state, text = '') => {
  let str = state ? '  ' : '';

  let s = state;
  while (s && s.parent && s.path === s.parent.path) {
    str += '  ';
    s = s.parent;
  }

  return str + text;
};

module.exports = { indent, indentModule };