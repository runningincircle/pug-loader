// method render via loader option
const html = require('Views/widget.pug?{"a":10,"b":"abc"}');
// method compile via query parameter
const tmpl = require('Views/widget.pug?pug-compile&{"a":20,"b":"def"}');

console.log(html);
console.log(tmpl());