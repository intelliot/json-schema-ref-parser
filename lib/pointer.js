'use strict';

module.exports = Pointer;

var $Ref         = require('./ref'),
    util         = require('./util'),
    url          = require('url'),
    ono          = require('ono'),
    escapedSlash = /~1/g,
    escapedTilde = /~0/g;

/**
 * This class represents a single JSON pointer and its resolved value.
 *
 * @param {$Ref} $ref
 * @param {string} path
 * @constructor
 */
function Pointer($ref, path) {
  /**
   * The {@link $Ref} object that contains this {@link Pointer} object.
   * @type {$Ref}
   */
  this.$ref = $ref;

  /**
   * The file path or URL, containing the JSON pointer in the hash.
   * This path is relative to the path of the main JSON schema file.
   * @type {string}
   */
  this.path = path;

  /**
   * The value of the JSON pointer.
   * Can be any JSON type, not just objects. Unknown file types are represented as Buffers (byte arrays).
   * @type {?*}
   */
  this.value = undefined;
}

/**
 * Resolves the value of a nested property within the given object.
 *
 * @param {*} obj - The object that will be crawled
 * @param {$RefParserOptions} [options]
 *
 * @returns {Pointer}
 * Returns a JSON pointer whose {@link Pointer#value} is the resolved value.
 * If resolving this value required resolving other JSON references, then
 * the {@link Pointer#$ref} and {@link Pointer#path} will reflect the resolution path
 * of the resolved value.
 */
Pointer.prototype.resolve = function(obj, options) {
  var tokens = Pointer.parse(this.path);
  this.value = obj;

  // Crawl the value, one token at a time
  for (var i = 0; i < tokens.length; i++) {
    resolveIf$Ref(this, options);

    var token = tokens[i];
    if (this.value[token] === undefined) {
      throw ono.syntax('Error resolving $ref pointer "%s". \nToken "%s" does not exist.', path, token);
    }
    else {
      this.value = this.value[token];
    }
  }

  // Resolve the final value
  resolveIf$Ref(this, options);
  return this;
};

/**
 * Sets the value of a nested property within the given object.
 *
 * @param {*} obj - The object that will be crawled
 * @param {*} value - the value to assign
 * @param {$RefParserOptions} [options]
 *
 * @returns {*}
 * Returns the modified object, or an entirely new object if the entire object is overwritten.
 */
Pointer.prototype.set = function(obj, value, options) {
  var tokens = Pointer.parse(this.path);

  if (tokens.length === 0) {
    // There are no tokens, replace the entire object with the new value
    this.value = value;
    return value;
  }

  // Crawl the object, one token at a time
  this.value = obj;
  for (var i = 0; i < tokens.length - 1; i++) {
    resolveIf$Ref(this, options);

    var token = tokens[i];
    if (this.value && this.value[token] !== undefined) {
      // The token exists
      this.value = this.value[token];
    }
    else {
      // The token doesn't exist, so create it
      this.value = setValue(this, token, {});
    }
  }

  // Set the value of the final token
  resolveIf$Ref(this, options);
  token = tokens[tokens.length - 1];
  setValue(this, token, value);

  // Return the updated object
  return obj;
};

/**
 * Parses a JSON pointer (or a path containing a JSON pointer in the hash)
 * and returns an array of the pointer's tokens.
 * (e.g. "schema.json#/definitions/person/name" => ["definitions", "person", "name"])
 *
 * The pointer is parsed according to RFC 6901
 * {@link https://tools.ietf.org/html/rfc6901#section-3}
 *
 * @param {string} path
 * @returns {string[]}
 */
Pointer.parse = function(path) {
  // Get the JSON pointer from the path's hash
  var pointer = util.path.getHash(path).substr(1);

  // If there's no pointer, then there are no tokens,
  // so return an empty array
  if (!pointer) {
    return [];
  }

  // Split into an array
  pointer = pointer.split('/');

  // Decode each part, according to RFC 6901
  for (var i = 0; i < pointer.length; i++) {
    pointer[i] = pointer[i].replace(escapedSlash, '/').replace(escapedTilde, '~');
  }

  if (pointer[0] !== '') {
    throw ono.syntax('Invalid $ref pointer "%s". Pointers must begin with "#/"', pointer);
  }

  return pointer.slice(1);
};

/**
 * If the given pointer's {@link Pointer#value} is a JSON reference,
 * then the reference is resolved and {@link Pointer#value} is replaced with the resolved value.
 * In addition, {@link Pointer#path} and {@link Pointer#$ref} are updated to reflect the
 * resolution path of the new value.
 *
 * @param {Pointer} pointer
 * @param {$RefParserOptions} [options]
 */
function resolveIf$Ref(pointer, options) {
  // Is the value a JSON reference? (and allowed?)
  if ($Ref.isAllowed$Ref(pointer.value, options)) {
    var $refPath = url.resolve(pointer.path, pointer.value.$ref);

    // Is the value a reference to itself?  If so, then there's nothing to do.
    if ($refPath !== pointer.path) {
      // Resolve the reference
      var resolved = pointer.$ref.$refs._resolve($refPath);
      pointer.$ref = resolved.$ref;
      pointer.path = resolved.path;    // pointer.path = $refPath ???
      pointer.value = resolved.value;
    }
  }
}

/**
 * Sets the specified token value of the {@link Pointer#value}.
 *
 * The token is evaluated according to RFC 6901.
 * {@link https://tools.ietf.org/html/rfc6901#section-4}
 *
 * @param {Pointer} pointer - The JSON Pointer whose value will be modified
 * @param {string} token - A JSON Pointer token that indicates how to modify `obj`
 * @param {*} value - The value to assign
 * @returns {*} - Returns the assigned value
 */
function setValue(pointer, token, value) {
  if (pointer.value && typeof(pointer.value) === 'object') {
    if (token === '-' && Array.isArray(pointer.value)) {
      pointer.value.push(value);
    }
    else {
      pointer.value[token] = value;
    }
  }
  else {
    throw ono.syntax('Error assigning $ref pointer "%s". \nCannot set "%s" of a non-object.', pointer.path, token);
  }
  return value;
}