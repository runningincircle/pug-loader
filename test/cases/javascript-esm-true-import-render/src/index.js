import html1 from 'Views/widget.pug';
import html2 from 'Views/widget.pug?{"a":10,"b":"xyz"}';
import html3 from 'Views/widget.pug?a=20&b=zzz';

console.log(html1 + html2 + html3);