const path = require('path'),
  pug = require('pug'),
  walk = require('pug-walk');

const { merge } = require('webpack-merge');
const parseResourceData = require('./utils/parse');

let webpackResolveAlias = {};

/**
 * @param {string} match The matched alias.
 * @return {string} The regex pattern with matched aliases.
 */
const regexpAlias = (match) => `^[~@]?(${match})(?=\\/)`;

/**
 * Replace founded alias in require argument.
 *
 * @param {string} value The resource value include require('').
 * @param {{}} aliases The `resolve.alias` of webpack config.
 * @param {function(string):string} regexp The function return a regex pattern string. The argument is alias name.
 * @return {string} The string with replaced alias.
 */
const resolveAlias = (value, aliases, regexp) => {
  let result = value;
  const patternAliases = Object.keys(aliases).join('|');

  if (!patternAliases) return result;

  const aliasMatch = new RegExp(regexp(patternAliases)).exec(value);
  if (aliasMatch) {
    const alias = aliasMatch[1];
    result = value.replace(new RegExp(regexp(alias)), aliases[alias]).replace('//', '/');
  }

  return result;
};

/**
 * Resolve a path in the argument of require() function.
 *
 * @param {string} value The resource value include require().
 * @param {string} templateFile
 * @param {{}} aliases The resolve.alias from webpack config.
 * @return {string|null}
 */
const resolveRequirePath = function (value, templateFile, aliases) {
  // 1. delete `./` from path, because at begin will be added full path like `/path/to/current/dir/`
  value = value.replace(/(?<=[^\.])(\.\/)/, '');

  // 2. replace alias with absolute path
  let result = resolveAlias(value, aliases, (match) => `(?<=["'\`])(${match})(?=\/)`);
  if (result !== value) return result;

  // 3. if the alias is not found in the path,
  // then add the absolute path of the current template at the beginning of the argument,
  // e.g. like this require('/path/to/template/' + 'filename.jpeg')
  const matches = /\((.+)\)/.exec(value);
  if (matches) {
    let arg = matches[1];
    // 4. if an argument of require() begin with a relative parent path as the string template with a variable,
    // like require(`../images/${file}`), then extract the relative path to the separate string
    if (arg.indexOf('`../') === 0) {
      const relPathRegex = /(?<=`)(.+)(?=\$\{)/;
      const relPathMatches = relPathRegex.exec(value);
      if (relPathMatches) {
        arg = `'${relPathMatches[1]}' + ` + arg.replace(relPathRegex, '');
      }
    }
    result = `require('${path.dirname(templateFile)}/' + ${arg})`;
  }

  return result;
};

/**
 * Pug plugin to resolve path for include, extend, require.
 *
 * @type {{preLoad: (function(*): *)}}
 */
const resolvePlugin = {
  preLoad: (ast) =>
    walk(ast, (node) => {
      if (node.type === 'FileReference') {
        let result = resolveAlias(node.path, webpackResolveAlias, regexpAlias);
        if (result && result !== node.path) node.path = result;
      } else if (node.attrs) {
        node.attrs.forEach((attr) => {
          if (attr.val && typeof attr.val === 'string' && attr.val.indexOf('require(') === 0) {
            let result = resolveRequirePath(attr.val, attr.filename, webpackResolveAlias);
            if (result && result !== attr.val) attr.val = result;
          }
        });
      }
    }),
};

/**
 * @param {string} content The pug template.
 * @param {function(error: string|null, result: string?)?} callback The asynchronous callback function.
 * @return {string|undefined}
 */
const compilePugContent = function (content, callback) {
  let res = {};
  const loaderContext = this,
    filename = loaderContext.resourcePath,
    loaderOptions = loaderContext.getOptions() || {},
    data = getResourceParams(loaderContext.resourceQuery),
    map = [
      {
        method: 'compile',
        queryParam: 'pug-compile',
        moduleExport: (name) => `;module.exports=${name};`,
      },
      {
        method: 'render',
        queryParam: 'pug-render',
        moduleExport: (name) => `;module.exports=${name}();`,
      },
    ],
    // the rule: a method defined in the resource query has highest priority over a method defined in the loader options
    // because a method from loader options is global but a query method override by local usage a global method
    methodFromQuery = map.find((item) => data.hasOwnProperty(item.queryParam)),
    methodFromOptions = map.find((item) => loaderOptions.method === item.method),
    method = methodFromQuery || methodFromOptions || map[0];

  // remove pug method from query data to pass only clean data w/o meta params
  delete data[method.queryParam];

  // template variables from loader options data and resource query
  const locals = merge(loaderOptions.data || {}, data);

  // pug compiler options
  const options = {
    // used to resolve imports/extends and to improve errors
    filename: filename,
    // The root directory of all absolute inclusion. Defaults is /.
    //basedir: basedir,
    basedir: '/',
    doctype: loaderOptions.doctype || 'html',
    /** @deprecated This option is deprecated and must be false, see https://pugjs.org/api/reference.html#options */
    pretty: false,
    filters: loaderOptions.filters,
    self: loaderOptions.self || false,
    // Output compiled function to stdout. Must be false.
    debug: false,
    // Include the function source in the compiled template. Defaults is false.
    compileDebug: loaderOptions.debug || false,
    globals: ['require', ...(loaderOptions.globals || [])],
    // Load all requires as function. Must be true.
    inlineRuntimeFunctions: true,
    //inlineRuntimeFunctions: false,
    // default name of template function is `template`
    name: loaderOptions.name || 'template',
    // the template without export module syntax, because the export will be determined depending on the method
    module: false,
    plugins: [resolvePlugin, ...(loaderOptions.plugins || [])],
  };

  loaderContext.cacheable && loaderContext.cacheable(true);

  try {
    /** @type {{body: string, dependencies: []}} */
    res = pug.compileClientWithDependenciesTracked(content, options);
  } catch (exception) {
    // watch files in which an error occurred
    loaderContext.addDependency(path.normalize(exception.filename));
    // show original error
    console.log('[pug compiler error] ', exception);
    callback(exception);
    return;
  }

  // add dependency files to watch changes
  if (res.dependencies.length) res.dependencies.forEach(loaderContext.addDependency);

  let template = res.body;

  if (Object.keys(locals).length) {
    // merge the template variable `locals` in the code `var locals_for_with = (locals || {});`
    // with a data from resource query and loader options, to allow pass a data into template at compile time, e.g.:
    // const html = require('template.pug?{"a":10,"b":"abc"}');
    const templateLocalsPattern = /(?<=locals_for_with = )(?:\(locals \|\| {}\))(?=;)/,
      mergedQueryDataAndLocals = 'Object.assign(' + JSON.stringify(locals) + ', locals)';

    template = template.replace(templateLocalsPattern, mergedQueryDataAndLocals);
  }

  template += method.moduleExport(options.name);
  callback(null, template);
};

/**
 * Get data from the resource query.
 *
 * @param {string} str
 * @return {{}}
 */
const getResourceParams = function (str) {
  if (str[0] !== '?') return {};
  const query = str.substr(1);

  return parseResourceData(query);
};

// Asynchronous Loader, see https://webpack.js.org/api/loaders/#asynchronous-loaders
module.exports = function (content, map, meta) {
  const callback = this.async();

  // save resolve.alias from webpack config for usage in pug plugin,
  // see https://webpack.js.org/api/loaders/#this_compiler
  webpackResolveAlias = this._compiler.options.resolve.alias || {};

  compilePugContent.call(this, content, (err, result) => {
    if (err) return callback(err);
    callback(null, result, map, meta);
  });
};

// exports for test
module.exports.getResourceParams = getResourceParams;
module.exports.regexpAlias = regexpAlias;
module.exports.resolveAlias = resolveAlias;
module.exports.resolveRequirePath = resolveRequirePath;
