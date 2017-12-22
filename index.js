// Very much inspired by coffee-lint-loader & eslint-loader

"use strict"

var assign = require("object-assign")
var loaderUtils = require("loader-utils")
var createCache = require("loader-fs-cache")
var cache = createCache("cslint-loader")
var coffeelint = require("coffeelint")
var stripComments = require('strip-json-comments')
var textTable = require("text-table")
var chalk = require("chalk")
var fs = require("fs")

class CSLintError extends Error {
  constructor(messages) {
    super()
    this.name = "CSLintError"
    this.message = messages
    this.stack = ""
  }

  inspect() {
    return this.message
  }
}

function pluralize(word, count) {
  return (count === 1 ? word : word + "s");
}

function loadRules(path) {
  try {
    var realPath = fs.realpathSync(path)
    var content = fs.readFileSync(realPath).toString()
    return JSON.parse(stripComments(content))
  } catch (e) {
    throw e
  }
}

/**
 * webpack loader
 *
 * @param  {String|Buffer} input JavaScript string
 * @param {Object} map input source map
 * @return {void}
 */
module.exports = function(input, map) {
  var webpack = this

  var userOptions = assign(
    this.options.coffeelint || {},
    loaderUtils.getOptions(this)
  )

  var config = assign(
    {
      cacheIdentifier: JSON.stringify({
        cslint: require(userOptions.cslintPath || "coffeelint").version,
      }),
      configFile: './coffeelint.json',
      literate: false,
      cache: true,
    },
    userOptions
  )

  var lintRules = assign({}, config.rules || {}, loadRules(config.configFile))
  webpack.addDependency(config.configFile)

  var cacheDirectory = config.cache
  var cacheIdentifier = config.cacheIdentifier

  delete config.cacheDirectory
  delete config.cacheIdentifier

  this.cacheable()

  var resourcePath = webpack.resourcePath
  var cwd = process.cwd()

  if (resourcePath.indexOf(cwd) === 0) {
    resourcePath = resourcePath.substr(cwd.length + 1)
  }

  if (config.cache) {
    var callback = this.async()
    return cache(
      {
        directory: cacheDirectory,
        identifier: cacheIdentifier,
        options: config,
        source: input,
        transform: function() {
          return lint(input, lintRules, config.literate)
        },
      },
      function(err, res) {
        if (err) {
          return callback(err)
        }
        printLinterOutput(res || [], config, webpack, resourcePath)
        return callback(null, input, map)
      }
    )
  }
  printLinterOutput(lint(input, lintRules, config.literate), config, this, resourcePath)
  this.callback(null, input, map)
}

function printLinterOutput(data, config, webpack, resourcePath) {
  var reporter = config.reporter
  var quiet = config.quiet
  var warnings = 0
  var errors = 0

  if (data.length) {
    if (reporter) { return reporter(data) }

    var rows = []

    data.forEach(function(issue) {
      var error = (issue.level == "error")
      var level = error ? chalk.red(issue.level) : chalk.yellow(issue.level)
      var context = chalk.white.bold(issue.context || issue.message)

      if (!quiet || error) {
        if (error) { errors++ } else { warnings++ }
        rows.push(["", chalk.gray(issue.lineNumber + (issue.lineNumberEnd ? '-'+issue.lineNumberEnd : '')), level, context, chalk.gray(issue.rule)])
      }
    })

    var color = errors ? "red" : "yellow"

    var path = chalk.underline[color](resourcePath) + "\n"

    var table = textTable(rows, {align: ["", "r", "l", "l"]}) + "\n"

    var total = warnings + errors
    var summary = [
        "\u2716 ", total, pluralize(" problem", total),
        " (", errors, pluralize(" error", errors), ", ",
        warnings, pluralize(" warning", warnings), ")"
    ].join("")

    var output = ("\n" + path + table + "\n" + chalk[color].bold(summary))

    var emitter = errors > 0 ? webpack.emitError : webpack.emitWarning

    if (config.emitError) {
      emitter = webpack.emitError
    }
    else if (config.emitWarning) {
      emitter = webpack.emitWarning
    }

    if (emitter) {
      if (config.failOnError && errors) {
        throw new CSLintError(
          "Module failed because of a cslint error.\n" + output
        )
      }
      else if (config.failOnWarning && warnings) {
        throw new CSLintError(
          "Module failed because of a cslint warning.\n" + output
        )
      }

      emitter(webpack.version === 2 ? new CSLintError(output) : output)
    }
    else {
      throw new Error(
        "Your module system doesn't support emitWarning. " +
          "Update available? \n" +
          output
      )
    }
  }
}

function lint(input, rules, literate) {
  return coffeelint.lint(input, rules, literate)
}
