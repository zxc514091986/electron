'use strict'

const v8Util = process.atomBinding('v8_util')

exports.isPromisified = function (func) {
  return v8Util.getHiddenValue(func, 'promisified') === true
}

exports.markPromisified = function (func) {
  v8Util.setHiddenValue(func, 'promisified', true)
}
