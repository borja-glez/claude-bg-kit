#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/yaml/dist/nodes/identity.js
var require_identity = __commonJS({
  "node_modules/yaml/dist/nodes/identity.js"(exports2) {
    "use strict";
    var ALIAS = Symbol.for("yaml.alias");
    var DOC = Symbol.for("yaml.document");
    var MAP = Symbol.for("yaml.map");
    var PAIR = Symbol.for("yaml.pair");
    var SCALAR = Symbol.for("yaml.scalar");
    var SEQ = Symbol.for("yaml.seq");
    var NODE_TYPE = Symbol.for("yaml.node.type");
    var isAlias = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === ALIAS;
    var isDocument = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === DOC;
    var isMap = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === MAP;
    var isPair = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === PAIR;
    var isScalar = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === SCALAR;
    var isSeq = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === SEQ;
    function isCollection(node) {
      if (node && typeof node === "object")
        switch (node[NODE_TYPE]) {
          case MAP:
          case SEQ:
            return true;
        }
      return false;
    }
    function isNode(node) {
      if (node && typeof node === "object")
        switch (node[NODE_TYPE]) {
          case ALIAS:
          case MAP:
          case SCALAR:
          case SEQ:
            return true;
        }
      return false;
    }
    var hasAnchor = (node) => (isScalar(node) || isCollection(node)) && !!node.anchor;
    exports2.ALIAS = ALIAS;
    exports2.DOC = DOC;
    exports2.MAP = MAP;
    exports2.NODE_TYPE = NODE_TYPE;
    exports2.PAIR = PAIR;
    exports2.SCALAR = SCALAR;
    exports2.SEQ = SEQ;
    exports2.hasAnchor = hasAnchor;
    exports2.isAlias = isAlias;
    exports2.isCollection = isCollection;
    exports2.isDocument = isDocument;
    exports2.isMap = isMap;
    exports2.isNode = isNode;
    exports2.isPair = isPair;
    exports2.isScalar = isScalar;
    exports2.isSeq = isSeq;
  }
});

// node_modules/yaml/dist/visit.js
var require_visit = __commonJS({
  "node_modules/yaml/dist/visit.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var BREAK = Symbol("break visit");
    var SKIP = Symbol("skip children");
    var REMOVE = Symbol("remove node");
    function visit(node, visitor) {
      const visitor_ = initVisitor(visitor);
      if (identity.isDocument(node)) {
        const cd = visit_(null, node.contents, visitor_, Object.freeze([node]));
        if (cd === REMOVE)
          node.contents = null;
      } else
        visit_(null, node, visitor_, Object.freeze([]));
    }
    visit.BREAK = BREAK;
    visit.SKIP = SKIP;
    visit.REMOVE = REMOVE;
    function visit_(key, node, visitor, path17) {
      const ctrl = callVisitor(key, node, visitor, path17);
      if (identity.isNode(ctrl) || identity.isPair(ctrl)) {
        replaceNode(key, path17, ctrl);
        return visit_(key, ctrl, visitor, path17);
      }
      if (typeof ctrl !== "symbol") {
        if (identity.isCollection(node)) {
          path17 = Object.freeze(path17.concat(node));
          for (let i = 0; i < node.items.length; ++i) {
            const ci = visit_(i, node.items[i], visitor, path17);
            if (typeof ci === "number")
              i = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              node.items.splice(i, 1);
              i -= 1;
            }
          }
        } else if (identity.isPair(node)) {
          path17 = Object.freeze(path17.concat(node));
          const ck = visit_("key", node.key, visitor, path17);
          if (ck === BREAK)
            return BREAK;
          else if (ck === REMOVE)
            node.key = null;
          const cv = visit_("value", node.value, visitor, path17);
          if (cv === BREAK)
            return BREAK;
          else if (cv === REMOVE)
            node.value = null;
        }
      }
      return ctrl;
    }
    async function visitAsync(node, visitor) {
      const visitor_ = initVisitor(visitor);
      if (identity.isDocument(node)) {
        const cd = await visitAsync_(null, node.contents, visitor_, Object.freeze([node]));
        if (cd === REMOVE)
          node.contents = null;
      } else
        await visitAsync_(null, node, visitor_, Object.freeze([]));
    }
    visitAsync.BREAK = BREAK;
    visitAsync.SKIP = SKIP;
    visitAsync.REMOVE = REMOVE;
    async function visitAsync_(key, node, visitor, path17) {
      const ctrl = await callVisitor(key, node, visitor, path17);
      if (identity.isNode(ctrl) || identity.isPair(ctrl)) {
        replaceNode(key, path17, ctrl);
        return visitAsync_(key, ctrl, visitor, path17);
      }
      if (typeof ctrl !== "symbol") {
        if (identity.isCollection(node)) {
          path17 = Object.freeze(path17.concat(node));
          for (let i = 0; i < node.items.length; ++i) {
            const ci = await visitAsync_(i, node.items[i], visitor, path17);
            if (typeof ci === "number")
              i = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              node.items.splice(i, 1);
              i -= 1;
            }
          }
        } else if (identity.isPair(node)) {
          path17 = Object.freeze(path17.concat(node));
          const ck = await visitAsync_("key", node.key, visitor, path17);
          if (ck === BREAK)
            return BREAK;
          else if (ck === REMOVE)
            node.key = null;
          const cv = await visitAsync_("value", node.value, visitor, path17);
          if (cv === BREAK)
            return BREAK;
          else if (cv === REMOVE)
            node.value = null;
        }
      }
      return ctrl;
    }
    function initVisitor(visitor) {
      if (typeof visitor === "object" && (visitor.Collection || visitor.Node || visitor.Value)) {
        return Object.assign({
          Alias: visitor.Node,
          Map: visitor.Node,
          Scalar: visitor.Node,
          Seq: visitor.Node
        }, visitor.Value && {
          Map: visitor.Value,
          Scalar: visitor.Value,
          Seq: visitor.Value
        }, visitor.Collection && {
          Map: visitor.Collection,
          Seq: visitor.Collection
        }, visitor);
      }
      return visitor;
    }
    function callVisitor(key, node, visitor, path17) {
      if (typeof visitor === "function")
        return visitor(key, node, path17);
      if (identity.isMap(node))
        return visitor.Map?.(key, node, path17);
      if (identity.isSeq(node))
        return visitor.Seq?.(key, node, path17);
      if (identity.isPair(node))
        return visitor.Pair?.(key, node, path17);
      if (identity.isScalar(node))
        return visitor.Scalar?.(key, node, path17);
      if (identity.isAlias(node))
        return visitor.Alias?.(key, node, path17);
      return void 0;
    }
    function replaceNode(key, path17, node) {
      const parent = path17[path17.length - 1];
      if (identity.isCollection(parent)) {
        parent.items[key] = node;
      } else if (identity.isPair(parent)) {
        if (key === "key")
          parent.key = node;
        else
          parent.value = node;
      } else if (identity.isDocument(parent)) {
        parent.contents = node;
      } else {
        const pt = identity.isAlias(parent) ? "alias" : "scalar";
        throw new Error(`Cannot replace node with ${pt} parent`);
      }
    }
    exports2.visit = visit;
    exports2.visitAsync = visitAsync;
  }
});

// node_modules/yaml/dist/doc/directives.js
var require_directives = __commonJS({
  "node_modules/yaml/dist/doc/directives.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var visit = require_visit();
    var escapeChars = {
      "!": "%21",
      ",": "%2C",
      "[": "%5B",
      "]": "%5D",
      "{": "%7B",
      "}": "%7D"
    };
    var escapeTagName = (tn) => tn.replace(/[!,[\]{}]/g, (ch) => escapeChars[ch]);
    var Directives = class _Directives {
      constructor(yaml, tags) {
        this.docStart = null;
        this.docEnd = false;
        this.yaml = Object.assign({}, _Directives.defaultYaml, yaml);
        this.tags = Object.assign({}, _Directives.defaultTags, tags);
      }
      clone() {
        const copy = new _Directives(this.yaml, this.tags);
        copy.docStart = this.docStart;
        return copy;
      }
      /**
       * During parsing, get a Directives instance for the current document and
       * update the stream state according to the current version's spec.
       */
      atDocument() {
        const res = new _Directives(this.yaml, this.tags);
        switch (this.yaml.version) {
          case "1.1":
            this.atNextDocument = true;
            break;
          case "1.2":
            this.atNextDocument = false;
            this.yaml = {
              explicit: _Directives.defaultYaml.explicit,
              version: "1.2"
            };
            this.tags = Object.assign({}, _Directives.defaultTags);
            break;
        }
        return res;
      }
      /**
       * @param onError - May be called even if the action was successful
       * @returns `true` on success
       */
      add(line, onError) {
        if (this.atNextDocument) {
          this.yaml = { explicit: _Directives.defaultYaml.explicit, version: "1.1" };
          this.tags = Object.assign({}, _Directives.defaultTags);
          this.atNextDocument = false;
        }
        const parts = line.trim().split(/[ \t]+/);
        const name = parts.shift();
        switch (name) {
          case "%TAG": {
            if (parts.length !== 2) {
              onError(0, "%TAG directive should contain exactly two parts");
              if (parts.length < 2)
                return false;
            }
            const [handle, prefix] = parts;
            this.tags[handle] = prefix;
            return true;
          }
          case "%YAML": {
            this.yaml.explicit = true;
            if (parts.length !== 1) {
              onError(0, "%YAML directive should contain exactly one part");
              return false;
            }
            const [version] = parts;
            if (version === "1.1" || version === "1.2") {
              this.yaml.version = version;
              return true;
            } else {
              const isValid2 = /^\d+\.\d+$/.test(version);
              onError(6, `Unsupported YAML version ${version}`, isValid2);
              return false;
            }
          }
          default:
            onError(0, `Unknown directive ${name}`, true);
            return false;
        }
      }
      /**
       * Resolves a tag, matching handles to those defined in %TAG directives.
       *
       * @returns Resolved tag, which may also be the non-specific tag `'!'` or a
       *   `'!local'` tag, or `null` if unresolvable.
       */
      tagName(source, onError) {
        if (source === "!")
          return "!";
        if (source[0] !== "!") {
          onError(`Not a valid tag: ${source}`);
          return null;
        }
        if (source[1] === "<") {
          const verbatim = source.slice(2, -1);
          if (verbatim === "!" || verbatim === "!!") {
            onError(`Verbatim tags aren't resolved, so ${source} is invalid.`);
            return null;
          }
          if (source[source.length - 1] !== ">")
            onError("Verbatim tags must end with a >");
          return verbatim;
        }
        const [, handle, suffix] = source.match(/^(.*!)([^!]*)$/s);
        if (!suffix)
          onError(`The ${source} tag has no suffix`);
        const prefix = this.tags[handle];
        if (prefix) {
          try {
            return prefix + decodeURIComponent(suffix);
          } catch (error) {
            onError(String(error));
            return null;
          }
        }
        if (handle === "!")
          return source;
        onError(`Could not resolve tag: ${source}`);
        return null;
      }
      /**
       * Given a fully resolved tag, returns its printable string form,
       * taking into account current tag prefixes and defaults.
       */
      tagString(tag) {
        for (const [handle, prefix] of Object.entries(this.tags)) {
          if (tag.startsWith(prefix))
            return handle + escapeTagName(tag.substring(prefix.length));
        }
        return tag[0] === "!" ? tag : `!<${tag}>`;
      }
      toString(doc) {
        const lines = this.yaml.explicit ? [`%YAML ${this.yaml.version || "1.2"}`] : [];
        const tagEntries = Object.entries(this.tags);
        let tagNames;
        if (doc && tagEntries.length > 0 && identity.isNode(doc.contents)) {
          const tags = {};
          visit.visit(doc.contents, (_key, node) => {
            if (identity.isNode(node) && node.tag)
              tags[node.tag] = true;
          });
          tagNames = Object.keys(tags);
        } else
          tagNames = [];
        for (const [handle, prefix] of tagEntries) {
          if (handle === "!!" && prefix === "tag:yaml.org,2002:")
            continue;
          if (!doc || tagNames.some((tn) => tn.startsWith(prefix)))
            lines.push(`%TAG ${handle} ${prefix}`);
        }
        return lines.join("\n");
      }
    };
    Directives.defaultYaml = { explicit: false, version: "1.2" };
    Directives.defaultTags = { "!!": "tag:yaml.org,2002:" };
    exports2.Directives = Directives;
  }
});

// node_modules/yaml/dist/doc/anchors.js
var require_anchors = __commonJS({
  "node_modules/yaml/dist/doc/anchors.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var visit = require_visit();
    function anchorIsValid(anchor) {
      if (/[\x00-\x19\s,[\]{}]/.test(anchor)) {
        const sa = JSON.stringify(anchor);
        const msg = `Anchor must not contain whitespace or control characters: ${sa}`;
        throw new Error(msg);
      }
      return true;
    }
    function anchorNames(root) {
      const anchors = /* @__PURE__ */ new Set();
      visit.visit(root, {
        Value(_key, node) {
          if (node.anchor)
            anchors.add(node.anchor);
        }
      });
      return anchors;
    }
    function findNewAnchor(prefix, exclude) {
      for (let i = 1; true; ++i) {
        const name = `${prefix}${i}`;
        if (!exclude.has(name))
          return name;
      }
    }
    function createNodeAnchors(doc, prefix) {
      const aliasObjects = [];
      const sourceObjects = /* @__PURE__ */ new Map();
      let prevAnchors = null;
      return {
        onAnchor: (source) => {
          aliasObjects.push(source);
          prevAnchors ?? (prevAnchors = anchorNames(doc));
          const anchor = findNewAnchor(prefix, prevAnchors);
          prevAnchors.add(anchor);
          return anchor;
        },
        /**
         * With circular references, the source node is only resolved after all
         * of its child nodes are. This is why anchors are set only after all of
         * the nodes have been created.
         */
        setAnchors: () => {
          for (const source of aliasObjects) {
            const ref = sourceObjects.get(source);
            if (typeof ref === "object" && ref.anchor && (identity.isScalar(ref.node) || identity.isCollection(ref.node))) {
              ref.node.anchor = ref.anchor;
            } else {
              const error = new Error("Failed to resolve repeated object (this should not happen)");
              error.source = source;
              throw error;
            }
          }
        },
        sourceObjects
      };
    }
    exports2.anchorIsValid = anchorIsValid;
    exports2.anchorNames = anchorNames;
    exports2.createNodeAnchors = createNodeAnchors;
    exports2.findNewAnchor = findNewAnchor;
  }
});

// node_modules/yaml/dist/doc/applyReviver.js
var require_applyReviver = __commonJS({
  "node_modules/yaml/dist/doc/applyReviver.js"(exports2) {
    "use strict";
    function applyReviver(reviver, obj, key, val) {
      if (val && typeof val === "object") {
        if (Array.isArray(val)) {
          for (let i = 0, len = val.length; i < len; ++i) {
            const v0 = val[i];
            const v1 = applyReviver(reviver, val, String(i), v0);
            if (v1 === void 0)
              delete val[i];
            else if (v1 !== v0)
              val[i] = v1;
          }
        } else if (val instanceof Map) {
          for (const k of Array.from(val.keys())) {
            const v0 = val.get(k);
            const v1 = applyReviver(reviver, val, k, v0);
            if (v1 === void 0)
              val.delete(k);
            else if (v1 !== v0)
              val.set(k, v1);
          }
        } else if (val instanceof Set) {
          for (const v0 of Array.from(val)) {
            const v1 = applyReviver(reviver, val, v0, v0);
            if (v1 === void 0)
              val.delete(v0);
            else if (v1 !== v0) {
              val.delete(v0);
              val.add(v1);
            }
          }
        } else {
          for (const [k, v0] of Object.entries(val)) {
            const v1 = applyReviver(reviver, val, k, v0);
            if (v1 === void 0)
              delete val[k];
            else if (v1 !== v0)
              val[k] = v1;
          }
        }
      }
      return reviver.call(obj, key, val);
    }
    exports2.applyReviver = applyReviver;
  }
});

// node_modules/yaml/dist/nodes/toJS.js
var require_toJS = __commonJS({
  "node_modules/yaml/dist/nodes/toJS.js"(exports2) {
    "use strict";
    var identity = require_identity();
    function toJS(value, arg, ctx) {
      if (Array.isArray(value))
        return value.map((v, i) => toJS(v, String(i), ctx));
      if (value && typeof value.toJSON === "function") {
        if (!ctx || !identity.hasAnchor(value))
          return value.toJSON(arg, ctx);
        const data = { aliasCount: 0, count: 1, res: void 0 };
        ctx.anchors.set(value, data);
        ctx.onCreate = (res2) => {
          data.res = res2;
          delete ctx.onCreate;
        };
        const res = value.toJSON(arg, ctx);
        if (ctx.onCreate)
          ctx.onCreate(res);
        return res;
      }
      if (typeof value === "bigint" && !ctx?.keep)
        return Number(value);
      return value;
    }
    exports2.toJS = toJS;
  }
});

// node_modules/yaml/dist/nodes/Node.js
var require_Node = __commonJS({
  "node_modules/yaml/dist/nodes/Node.js"(exports2) {
    "use strict";
    var applyReviver = require_applyReviver();
    var identity = require_identity();
    var toJS = require_toJS();
    var NodeBase = class {
      constructor(type) {
        Object.defineProperty(this, identity.NODE_TYPE, { value: type });
      }
      /** Create a copy of this node.  */
      clone() {
        const copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
        if (this.range)
          copy.range = this.range.slice();
        return copy;
      }
      /** A plain JavaScript representation of this node. */
      toJS(doc, { mapAsMap, maxAliasCount, onAnchor, reviver } = {}) {
        if (!identity.isDocument(doc))
          throw new TypeError("A document argument is required");
        const ctx = {
          anchors: /* @__PURE__ */ new Map(),
          doc,
          keep: true,
          mapAsMap: mapAsMap === true,
          mapKeyWarned: false,
          maxAliasCount: typeof maxAliasCount === "number" ? maxAliasCount : 100
        };
        const res = toJS.toJS(this, "", ctx);
        if (typeof onAnchor === "function")
          for (const { count: count2, res: res2 } of ctx.anchors.values())
            onAnchor(res2, count2);
        return typeof reviver === "function" ? applyReviver.applyReviver(reviver, { "": res }, "", res) : res;
      }
    };
    exports2.NodeBase = NodeBase;
  }
});

// node_modules/yaml/dist/nodes/Alias.js
var require_Alias = __commonJS({
  "node_modules/yaml/dist/nodes/Alias.js"(exports2) {
    "use strict";
    var anchors = require_anchors();
    var visit = require_visit();
    var identity = require_identity();
    var Node = require_Node();
    var toJS = require_toJS();
    var Alias = class extends Node.NodeBase {
      constructor(source) {
        super(identity.ALIAS);
        this.source = source;
        Object.defineProperty(this, "tag", {
          set() {
            throw new Error("Alias nodes cannot have tags");
          }
        });
      }
      /**
       * Resolve the value of this alias within `doc`, finding the last
       * instance of the `source` anchor before this node.
       */
      resolve(doc, ctx) {
        if (ctx?.maxAliasCount === 0)
          throw new ReferenceError("Alias resolution is disabled");
        let nodes;
        if (ctx?.aliasResolveCache) {
          nodes = ctx.aliasResolveCache;
        } else {
          nodes = [];
          visit.visit(doc, {
            Node: (_key, node) => {
              if (identity.isAlias(node) || identity.hasAnchor(node))
                nodes.push(node);
            }
          });
          if (ctx)
            ctx.aliasResolveCache = nodes;
        }
        let found = void 0;
        for (const node of nodes) {
          if (node === this)
            break;
          if (node.anchor === this.source)
            found = node;
        }
        if (found && ctx) {
          const { anchors: anchors2, doc: doc2, maxAliasCount } = ctx;
          let data = anchors2.get(found);
          if (!data) {
            toJS.toJS(found, null, ctx);
            data = anchors2.get(found);
          }
          if (data?.res === void 0) {
            const msg = "This should not happen: Alias anchor was not resolved?";
            throw new ReferenceError(msg);
          }
          if (maxAliasCount >= 0) {
            data.count += 1;
            if (data.aliasCount === 0)
              data.aliasCount = getAliasCount(doc2, found, anchors2);
            if (data.count * data.aliasCount > maxAliasCount) {
              const msg = "Excessive alias count indicates a resource exhaustion attack";
              throw new ReferenceError(msg);
            }
          }
        }
        return found;
      }
      toJSON(_arg, ctx) {
        if (!ctx)
          return { source: this.source };
        const source = this.resolve(ctx.doc, ctx);
        if (!source) {
          const msg = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
          throw new ReferenceError(msg);
        }
        return ctx.anchors.get(source).res;
      }
      toString(ctx, _onComment, _onChompKeep) {
        const src = `*${this.source}`;
        if (ctx) {
          anchors.anchorIsValid(this.source);
          if (ctx.options.verifyAliasOrder && !ctx.anchors.has(this.source)) {
            const msg = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
            throw new Error(msg);
          }
          if (ctx.implicitKey)
            return `${src} `;
        }
        return src;
      }
    };
    function getAliasCount(doc, node, anchors2) {
      if (identity.isAlias(node)) {
        const source = node.resolve(doc);
        const anchor = anchors2 && source && anchors2.get(source);
        return anchor ? anchor.count * anchor.aliasCount : 0;
      } else if (identity.isCollection(node)) {
        let count2 = 0;
        for (const item of node.items) {
          const c = getAliasCount(doc, item, anchors2);
          if (c > count2)
            count2 = c;
        }
        return count2;
      } else if (identity.isPair(node)) {
        const kc = getAliasCount(doc, node.key, anchors2);
        const vc = getAliasCount(doc, node.value, anchors2);
        return Math.max(kc, vc);
      }
      return 1;
    }
    exports2.Alias = Alias;
  }
});

// node_modules/yaml/dist/nodes/Scalar.js
var require_Scalar = __commonJS({
  "node_modules/yaml/dist/nodes/Scalar.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var Node = require_Node();
    var toJS = require_toJS();
    var isScalarValue = (value) => !value || typeof value !== "function" && typeof value !== "object";
    var Scalar = class extends Node.NodeBase {
      constructor(value) {
        super(identity.SCALAR);
        this.value = value;
      }
      toJSON(arg, ctx) {
        return ctx?.keep ? this.value : toJS.toJS(this.value, arg, ctx);
      }
      toString() {
        return String(this.value);
      }
    };
    Scalar.BLOCK_FOLDED = "BLOCK_FOLDED";
    Scalar.BLOCK_LITERAL = "BLOCK_LITERAL";
    Scalar.PLAIN = "PLAIN";
    Scalar.QUOTE_DOUBLE = "QUOTE_DOUBLE";
    Scalar.QUOTE_SINGLE = "QUOTE_SINGLE";
    exports2.Scalar = Scalar;
    exports2.isScalarValue = isScalarValue;
  }
});

// node_modules/yaml/dist/doc/createNode.js
var require_createNode = __commonJS({
  "node_modules/yaml/dist/doc/createNode.js"(exports2) {
    "use strict";
    var Alias = require_Alias();
    var identity = require_identity();
    var Scalar = require_Scalar();
    var defaultTagPrefix = "tag:yaml.org,2002:";
    function findTagObject(value, tagName, tags) {
      if (tagName) {
        const match = tags.filter((t) => t.tag === tagName);
        const tagObj = match.find((t) => !t.format) ?? match[0];
        if (!tagObj)
          throw new Error(`Tag ${tagName} not found`);
        return tagObj;
      }
      return tags.find((t) => t.identify?.(value) && !t.format);
    }
    function createNode(value, tagName, ctx) {
      if (identity.isDocument(value))
        value = value.contents;
      if (identity.isNode(value))
        return value;
      if (identity.isPair(value)) {
        const map = ctx.schema[identity.MAP].createNode?.(ctx.schema, null, ctx);
        map.items.push(value);
        return map;
      }
      if (value instanceof String || value instanceof Number || value instanceof Boolean || typeof BigInt !== "undefined" && value instanceof BigInt) {
        value = value.valueOf();
      }
      const { aliasDuplicateObjects, onAnchor, onTagObj, schema, sourceObjects } = ctx;
      let ref = void 0;
      if (aliasDuplicateObjects && value && typeof value === "object") {
        ref = sourceObjects.get(value);
        if (ref) {
          ref.anchor ?? (ref.anchor = onAnchor(value));
          return new Alias.Alias(ref.anchor);
        } else {
          ref = { anchor: null, node: null };
          sourceObjects.set(value, ref);
        }
      }
      if (tagName?.startsWith("!!"))
        tagName = defaultTagPrefix + tagName.slice(2);
      let tagObj = findTagObject(value, tagName, schema.tags);
      if (!tagObj) {
        if (value && typeof value.toJSON === "function") {
          value = value.toJSON();
        }
        if (!value || typeof value !== "object") {
          const node2 = new Scalar.Scalar(value);
          if (ref)
            ref.node = node2;
          return node2;
        }
        tagObj = value instanceof Map ? schema[identity.MAP] : Symbol.iterator in Object(value) ? schema[identity.SEQ] : schema[identity.MAP];
      }
      if (onTagObj) {
        onTagObj(tagObj);
        delete ctx.onTagObj;
      }
      const node = tagObj?.createNode ? tagObj.createNode(ctx.schema, value, ctx) : typeof tagObj?.nodeClass?.from === "function" ? tagObj.nodeClass.from(ctx.schema, value, ctx) : new Scalar.Scalar(value);
      if (tagName)
        node.tag = tagName;
      else if (!tagObj.default)
        node.tag = tagObj.tag;
      if (ref)
        ref.node = node;
      return node;
    }
    exports2.createNode = createNode;
  }
});

// node_modules/yaml/dist/nodes/Collection.js
var require_Collection = __commonJS({
  "node_modules/yaml/dist/nodes/Collection.js"(exports2) {
    "use strict";
    var createNode = require_createNode();
    var identity = require_identity();
    var Node = require_Node();
    function collectionFromPath(schema, path17, value) {
      let v = value;
      for (let i = path17.length - 1; i >= 0; --i) {
        const k = path17[i];
        if (typeof k === "number" && Number.isInteger(k) && k >= 0) {
          const a = [];
          a[k] = v;
          v = a;
        } else {
          v = /* @__PURE__ */ new Map([[k, v]]);
        }
      }
      return createNode.createNode(v, void 0, {
        aliasDuplicateObjects: false,
        keepUndefined: false,
        onAnchor: () => {
          throw new Error("This should not happen, please report a bug.");
        },
        schema,
        sourceObjects: /* @__PURE__ */ new Map()
      });
    }
    var isEmptyPath = (path17) => path17 == null || typeof path17 === "object" && !!path17[Symbol.iterator]().next().done;
    var Collection = class extends Node.NodeBase {
      constructor(type, schema) {
        super(type);
        Object.defineProperty(this, "schema", {
          value: schema,
          configurable: true,
          enumerable: false,
          writable: true
        });
      }
      /**
       * Create a copy of this collection.
       *
       * @param schema - If defined, overwrites the original's schema
       */
      clone(schema) {
        const copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
        if (schema)
          copy.schema = schema;
        copy.items = copy.items.map((it) => identity.isNode(it) || identity.isPair(it) ? it.clone(schema) : it);
        if (this.range)
          copy.range = this.range.slice();
        return copy;
      }
      /**
       * Adds a value to the collection. For `!!map` and `!!omap` the value must
       * be a Pair instance or a `{ key, value }` object, which may not have a key
       * that already exists in the map.
       */
      addIn(path17, value) {
        if (isEmptyPath(path17))
          this.add(value);
        else {
          const [key, ...rest] = path17;
          const node = this.get(key, true);
          if (identity.isCollection(node))
            node.addIn(rest, value);
          else if (node === void 0 && this.schema)
            this.set(key, collectionFromPath(this.schema, rest, value));
          else
            throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
        }
      }
      /**
       * Removes a value from the collection.
       * @returns `true` if the item was found and removed.
       */
      deleteIn(path17) {
        const [key, ...rest] = path17;
        if (rest.length === 0)
          return this.delete(key);
        const node = this.get(key, true);
        if (identity.isCollection(node))
          return node.deleteIn(rest);
        else
          throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
      }
      /**
       * Returns item at `key`, or `undefined` if not found. By default unwraps
       * scalar values from their surrounding node; to disable set `keepScalar` to
       * `true` (collections are always returned intact).
       */
      getIn(path17, keepScalar) {
        const [key, ...rest] = path17;
        const node = this.get(key, true);
        if (rest.length === 0)
          return !keepScalar && identity.isScalar(node) ? node.value : node;
        else
          return identity.isCollection(node) ? node.getIn(rest, keepScalar) : void 0;
      }
      hasAllNullValues(allowScalar) {
        return this.items.every((node) => {
          if (!identity.isPair(node))
            return false;
          const n = node.value;
          return n == null || allowScalar && identity.isScalar(n) && n.value == null && !n.commentBefore && !n.comment && !n.tag;
        });
      }
      /**
       * Checks if the collection includes a value with the key `key`.
       */
      hasIn(path17) {
        const [key, ...rest] = path17;
        if (rest.length === 0)
          return this.has(key);
        const node = this.get(key, true);
        return identity.isCollection(node) ? node.hasIn(rest) : false;
      }
      /**
       * Sets a value in this collection. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      setIn(path17, value) {
        const [key, ...rest] = path17;
        if (rest.length === 0) {
          this.set(key, value);
        } else {
          const node = this.get(key, true);
          if (identity.isCollection(node))
            node.setIn(rest, value);
          else if (node === void 0 && this.schema)
            this.set(key, collectionFromPath(this.schema, rest, value));
          else
            throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
        }
      }
    };
    exports2.Collection = Collection;
    exports2.collectionFromPath = collectionFromPath;
    exports2.isEmptyPath = isEmptyPath;
  }
});

// node_modules/yaml/dist/stringify/stringifyComment.js
var require_stringifyComment = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyComment.js"(exports2) {
    "use strict";
    var stringifyComment = (str5) => str5.replace(/^(?!$)(?: $)?/gm, "#");
    function indentComment(comment, indent) {
      if (/^\n+$/.test(comment))
        return comment.substring(1);
      return indent ? comment.replace(/^(?! *$)/gm, indent) : comment;
    }
    var lineComment = (str5, indent, comment) => str5.endsWith("\n") ? indentComment(comment, indent) : comment.includes("\n") ? "\n" + indentComment(comment, indent) : (str5.endsWith(" ") ? "" : " ") + comment;
    exports2.indentComment = indentComment;
    exports2.lineComment = lineComment;
    exports2.stringifyComment = stringifyComment;
  }
});

// node_modules/yaml/dist/stringify/foldFlowLines.js
var require_foldFlowLines = __commonJS({
  "node_modules/yaml/dist/stringify/foldFlowLines.js"(exports2) {
    "use strict";
    var FOLD_FLOW = "flow";
    var FOLD_BLOCK = "block";
    var FOLD_QUOTED = "quoted";
    function foldFlowLines(text, indent, mode = "flow", { indentAtStart, lineWidth = 80, minContentWidth = 20, onFold, onOverflow } = {}) {
      if (!lineWidth || lineWidth < 0)
        return text;
      if (lineWidth < minContentWidth)
        minContentWidth = 0;
      const endStep = Math.max(1 + minContentWidth, 1 + lineWidth - indent.length);
      if (text.length <= endStep)
        return text;
      const folds = [];
      const escapedFolds = {};
      let end = lineWidth - indent.length;
      if (typeof indentAtStart === "number") {
        if (indentAtStart > lineWidth - Math.max(2, minContentWidth))
          folds.push(0);
        else
          end = lineWidth - indentAtStart;
      }
      let split = void 0;
      let prev = void 0;
      let overflow = false;
      let i = -1;
      let escStart = -1;
      let escEnd = -1;
      if (mode === FOLD_BLOCK) {
        i = consumeMoreIndentedLines(text, i, indent.length);
        if (i !== -1)
          end = i + endStep;
      }
      for (let ch; ch = text[i += 1]; ) {
        if (mode === FOLD_QUOTED && ch === "\\") {
          escStart = i;
          switch (text[i + 1]) {
            case "x":
              i += 3;
              break;
            case "u":
              i += 5;
              break;
            case "U":
              i += 9;
              break;
            default:
              i += 1;
          }
          escEnd = i;
        }
        if (ch === "\n") {
          if (mode === FOLD_BLOCK)
            i = consumeMoreIndentedLines(text, i, indent.length);
          end = i + indent.length + endStep;
          split = void 0;
        } else {
          if (ch === " " && prev && prev !== " " && prev !== "\n" && prev !== "	") {
            const next = text[i + 1];
            if (next && next !== " " && next !== "\n" && next !== "	")
              split = i;
          }
          if (i >= end) {
            if (split) {
              folds.push(split);
              end = split + endStep;
              split = void 0;
            } else if (mode === FOLD_QUOTED) {
              while (prev === " " || prev === "	") {
                prev = ch;
                ch = text[i += 1];
                overflow = true;
              }
              const j = i > escEnd + 1 ? i - 2 : escStart - 1;
              if (escapedFolds[j])
                return text;
              folds.push(j);
              escapedFolds[j] = true;
              end = j + endStep;
              split = void 0;
            } else {
              overflow = true;
            }
          }
        }
        prev = ch;
      }
      if (overflow && onOverflow)
        onOverflow();
      if (folds.length === 0)
        return text;
      if (onFold)
        onFold();
      let res = text.slice(0, folds[0]);
      for (let i2 = 0; i2 < folds.length; ++i2) {
        const fold = folds[i2];
        const end2 = folds[i2 + 1] || text.length;
        if (fold === 0)
          res = `
${indent}${text.slice(0, end2)}`;
        else {
          if (mode === FOLD_QUOTED && escapedFolds[fold])
            res += `${text[fold]}\\`;
          res += `
${indent}${text.slice(fold + 1, end2)}`;
        }
      }
      return res;
    }
    function consumeMoreIndentedLines(text, i, indent) {
      let end = i;
      let start = i + 1;
      let ch = text[start];
      while (ch === " " || ch === "	") {
        if (i < start + indent) {
          ch = text[++i];
        } else {
          do {
            ch = text[++i];
          } while (ch && ch !== "\n");
          end = i;
          start = i + 1;
          ch = text[start];
        }
      }
      return end;
    }
    exports2.FOLD_BLOCK = FOLD_BLOCK;
    exports2.FOLD_FLOW = FOLD_FLOW;
    exports2.FOLD_QUOTED = FOLD_QUOTED;
    exports2.foldFlowLines = foldFlowLines;
  }
});

// node_modules/yaml/dist/stringify/stringifyString.js
var require_stringifyString = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyString.js"(exports2) {
    "use strict";
    var Scalar = require_Scalar();
    var foldFlowLines = require_foldFlowLines();
    var getFoldOptions = (ctx, isBlock) => ({
      indentAtStart: isBlock ? ctx.indent.length : ctx.indentAtStart,
      lineWidth: ctx.options.lineWidth,
      minContentWidth: ctx.options.minContentWidth
    });
    var containsDocumentMarker = (str5) => /^(%|---|\.\.\.)/m.test(str5);
    function lineLengthOverLimit(str5, lineWidth, indentLength) {
      if (!lineWidth || lineWidth < 0)
        return false;
      const limit = lineWidth - indentLength;
      const strLen = str5.length;
      if (strLen <= limit)
        return false;
      for (let i = 0, start = 0; i < strLen; ++i) {
        if (str5[i] === "\n") {
          if (i - start > limit)
            return true;
          start = i + 1;
          if (strLen - start <= limit)
            return false;
        }
      }
      return true;
    }
    function doubleQuotedString(value, ctx) {
      const json = JSON.stringify(value);
      if (ctx.options.doubleQuotedAsJSON)
        return json;
      const { implicitKey } = ctx;
      const minMultiLineLength = ctx.options.doubleQuotedMinMultiLineLength;
      const indent = ctx.indent || (containsDocumentMarker(value) ? "  " : "");
      let str5 = "";
      let start = 0;
      for (let i = 0, ch = json[i]; ch; ch = json[++i]) {
        if (ch === " " && json[i + 1] === "\\" && json[i + 2] === "n") {
          str5 += json.slice(start, i) + "\\ ";
          i += 1;
          start = i;
          ch = "\\";
        }
        if (ch === "\\")
          switch (json[i + 1]) {
            case "u":
              {
                str5 += json.slice(start, i);
                const code = json.substr(i + 2, 4);
                switch (code) {
                  case "0000":
                    str5 += "\\0";
                    break;
                  case "0007":
                    str5 += "\\a";
                    break;
                  case "000b":
                    str5 += "\\v";
                    break;
                  case "001b":
                    str5 += "\\e";
                    break;
                  case "0085":
                    str5 += "\\N";
                    break;
                  case "00a0":
                    str5 += "\\_";
                    break;
                  case "2028":
                    str5 += "\\L";
                    break;
                  case "2029":
                    str5 += "\\P";
                    break;
                  default:
                    if (code.substr(0, 2) === "00")
                      str5 += "\\x" + code.substr(2);
                    else
                      str5 += json.substr(i, 6);
                }
                i += 5;
                start = i + 1;
              }
              break;
            case "n":
              if (implicitKey || json[i + 2] === '"' || json.length < minMultiLineLength) {
                i += 1;
              } else {
                str5 += json.slice(start, i) + "\n\n";
                while (json[i + 2] === "\\" && json[i + 3] === "n" && json[i + 4] !== '"') {
                  str5 += "\n";
                  i += 2;
                }
                str5 += indent;
                if (json[i + 2] === " ")
                  str5 += "\\";
                i += 1;
                start = i + 1;
              }
              break;
            default:
              i += 1;
          }
      }
      str5 = start ? str5 + json.slice(start) : json;
      return implicitKey ? str5 : foldFlowLines.foldFlowLines(str5, indent, foldFlowLines.FOLD_QUOTED, getFoldOptions(ctx, false));
    }
    function singleQuotedString(value, ctx) {
      if (ctx.options.singleQuote === false || ctx.implicitKey && value.includes("\n") || /[ \t]\n|\n[ \t]/.test(value))
        return doubleQuotedString(value, ctx);
      const indent = ctx.indent || (containsDocumentMarker(value) ? "  " : "");
      const res = "'" + value.replace(/'/g, "''").replace(/\n+/g, `$&
${indent}`) + "'";
      return ctx.implicitKey ? res : foldFlowLines.foldFlowLines(res, indent, foldFlowLines.FOLD_FLOW, getFoldOptions(ctx, false));
    }
    function quotedString(value, ctx) {
      const { singleQuote } = ctx.options;
      let qs;
      if (singleQuote === false)
        qs = doubleQuotedString;
      else {
        const hasDouble = value.includes('"');
        const hasSingle = value.includes("'");
        if (hasDouble && !hasSingle)
          qs = singleQuotedString;
        else if (hasSingle && !hasDouble)
          qs = doubleQuotedString;
        else
          qs = singleQuote ? singleQuotedString : doubleQuotedString;
      }
      return qs(value, ctx);
    }
    var blockEndNewlines;
    try {
      blockEndNewlines = new RegExp("(^|(?<!\n))\n+(?!\n|$)", "g");
    } catch {
      blockEndNewlines = /\n+(?!\n|$)/g;
    }
    function blockString({ comment, type, value }, ctx, onComment, onChompKeep) {
      const { blockQuote, commentString, lineWidth } = ctx.options;
      if (!blockQuote || /\n[\t ]+$/.test(value)) {
        return quotedString(value, ctx);
      }
      const indent = ctx.indent || (ctx.forceBlockIndent || containsDocumentMarker(value) ? "  " : "");
      const literal = blockQuote === "literal" ? true : blockQuote === "folded" || type === Scalar.Scalar.BLOCK_FOLDED ? false : type === Scalar.Scalar.BLOCK_LITERAL ? true : !lineLengthOverLimit(value, lineWidth, indent.length);
      if (!value)
        return literal ? "|\n" : ">\n";
      let chomp;
      let endStart;
      for (endStart = value.length; endStart > 0; --endStart) {
        const ch = value[endStart - 1];
        if (ch !== "\n" && ch !== "	" && ch !== " ")
          break;
      }
      let end = value.substring(endStart);
      const endNlPos = end.indexOf("\n");
      if (endNlPos === -1) {
        chomp = "-";
      } else if (value === end || endNlPos !== end.length - 1) {
        chomp = "+";
        if (onChompKeep)
          onChompKeep();
      } else {
        chomp = "";
      }
      if (end) {
        value = value.slice(0, -end.length);
        if (end[end.length - 1] === "\n")
          end = end.slice(0, -1);
        end = end.replace(blockEndNewlines, `$&${indent}`);
      }
      let startWithSpace = false;
      let startEnd;
      let startNlPos = -1;
      for (startEnd = 0; startEnd < value.length; ++startEnd) {
        const ch = value[startEnd];
        if (ch === " ")
          startWithSpace = true;
        else if (ch === "\n")
          startNlPos = startEnd;
        else
          break;
      }
      let start = value.substring(0, startNlPos < startEnd ? startNlPos + 1 : startEnd);
      if (start) {
        value = value.substring(start.length);
        start = start.replace(/\n+/g, `$&${indent}`);
      }
      const indentSize = indent ? "2" : "1";
      let header = (startWithSpace ? indentSize : "") + chomp;
      if (comment) {
        header += " " + commentString(comment.replace(/ ?[\r\n]+/g, " "));
        if (onComment)
          onComment();
      }
      if (!literal) {
        const foldedValue = value.replace(/\n+/g, "\n$&").replace(/(?:^|\n)([\t ].*)(?:([\n\t ]*)\n(?![\n\t ]))?/g, "$1$2").replace(/\n+/g, `$&${indent}`);
        let literalFallback = false;
        const foldOptions = getFoldOptions(ctx, true);
        if (blockQuote !== "folded" && type !== Scalar.Scalar.BLOCK_FOLDED) {
          foldOptions.onOverflow = () => {
            literalFallback = true;
          };
        }
        const body = foldFlowLines.foldFlowLines(`${start}${foldedValue}${end}`, indent, foldFlowLines.FOLD_BLOCK, foldOptions);
        if (!literalFallback)
          return `>${header}
${indent}${body}`;
      }
      value = value.replace(/\n+/g, `$&${indent}`);
      return `|${header}
${indent}${start}${value}${end}`;
    }
    function plainString(item, ctx, onComment, onChompKeep) {
      const { type, value } = item;
      const { actualString, implicitKey, indent, indentStep, inFlow } = ctx;
      if (implicitKey && value.includes("\n") || inFlow && /[[\]{},]/.test(value)) {
        return quotedString(value, ctx);
      }
      if (/^[\n\t ,[\]{}#&*!|>'"%@`]|^[?-]$|^[?-][ \t]|[\n:][ \t]|[ \t]\n|[\n\t ]#|[\n\t :]$/.test(value)) {
        return implicitKey || inFlow || !value.includes("\n") ? quotedString(value, ctx) : blockString(item, ctx, onComment, onChompKeep);
      }
      if (!implicitKey && !inFlow && type !== Scalar.Scalar.PLAIN && value.includes("\n")) {
        return blockString(item, ctx, onComment, onChompKeep);
      }
      if (containsDocumentMarker(value)) {
        if (indent === "") {
          ctx.forceBlockIndent = true;
          return blockString(item, ctx, onComment, onChompKeep);
        } else if (implicitKey && indent === indentStep) {
          return quotedString(value, ctx);
        }
      }
      const str5 = value.replace(/\n+/g, `$&
${indent}`);
      if (actualString) {
        const test = (tag) => tag.default && tag.tag !== "tag:yaml.org,2002:str" && tag.test?.test(str5);
        const { compat, tags } = ctx.doc.schema;
        if (tags.some(test) || compat?.some(test))
          return quotedString(value, ctx);
      }
      return implicitKey ? str5 : foldFlowLines.foldFlowLines(str5, indent, foldFlowLines.FOLD_FLOW, getFoldOptions(ctx, false));
    }
    function stringifyString(item, ctx, onComment, onChompKeep) {
      const { implicitKey, inFlow } = ctx;
      const ss = typeof item.value === "string" ? item : Object.assign({}, item, { value: String(item.value) });
      let { type } = item;
      if (type !== Scalar.Scalar.QUOTE_DOUBLE) {
        if (/[\x00-\x08\x0b-\x1f\x7f-\x9f\u{D800}-\u{DFFF}]/u.test(ss.value))
          type = Scalar.Scalar.QUOTE_DOUBLE;
      }
      const _stringify = (_type) => {
        switch (_type) {
          case Scalar.Scalar.BLOCK_FOLDED:
          case Scalar.Scalar.BLOCK_LITERAL:
            return implicitKey || inFlow ? quotedString(ss.value, ctx) : blockString(ss, ctx, onComment, onChompKeep);
          case Scalar.Scalar.QUOTE_DOUBLE:
            return doubleQuotedString(ss.value, ctx);
          case Scalar.Scalar.QUOTE_SINGLE:
            return singleQuotedString(ss.value, ctx);
          case Scalar.Scalar.PLAIN:
            return plainString(ss, ctx, onComment, onChompKeep);
          default:
            return null;
        }
      };
      let res = _stringify(type);
      if (res === null) {
        const { defaultKeyType, defaultStringType } = ctx.options;
        const t = implicitKey && defaultKeyType || defaultStringType;
        res = _stringify(t);
        if (res === null)
          throw new Error(`Unsupported default string type ${t}`);
      }
      return res;
    }
    exports2.stringifyString = stringifyString;
  }
});

// node_modules/yaml/dist/stringify/stringify.js
var require_stringify = __commonJS({
  "node_modules/yaml/dist/stringify/stringify.js"(exports2) {
    "use strict";
    var anchors = require_anchors();
    var identity = require_identity();
    var stringifyComment = require_stringifyComment();
    var stringifyString = require_stringifyString();
    function createStringifyContext(doc, options) {
      const opt = Object.assign({
        blockQuote: true,
        commentString: stringifyComment.stringifyComment,
        defaultKeyType: null,
        defaultStringType: "PLAIN",
        directives: null,
        doubleQuotedAsJSON: false,
        doubleQuotedMinMultiLineLength: 40,
        falseStr: "false",
        flowCollectionPadding: true,
        indentSeq: true,
        lineWidth: 80,
        minContentWidth: 20,
        nullStr: "null",
        simpleKeys: false,
        singleQuote: null,
        trailingComma: false,
        trueStr: "true",
        verifyAliasOrder: true
      }, doc.schema.toStringOptions, options);
      let inFlow;
      switch (opt.collectionStyle) {
        case "block":
          inFlow = false;
          break;
        case "flow":
          inFlow = true;
          break;
        default:
          inFlow = null;
      }
      return {
        anchors: /* @__PURE__ */ new Set(),
        doc,
        flowCollectionPadding: opt.flowCollectionPadding ? " " : "",
        indent: "",
        indentStep: typeof opt.indent === "number" ? " ".repeat(opt.indent) : "  ",
        inFlow,
        options: opt
      };
    }
    function getTagObject(tags, item) {
      if (item.tag) {
        const match = tags.filter((t) => t.tag === item.tag);
        if (match.length > 0)
          return match.find((t) => t.format === item.format) ?? match[0];
      }
      let tagObj = void 0;
      let obj;
      if (identity.isScalar(item)) {
        obj = item.value;
        let match = tags.filter((t) => t.identify?.(obj));
        if (match.length > 1) {
          const testMatch = match.filter((t) => t.test);
          if (testMatch.length > 0)
            match = testMatch;
        }
        tagObj = match.find((t) => t.format === item.format) ?? match.find((t) => !t.format);
      } else {
        obj = item;
        tagObj = tags.find((t) => t.nodeClass && obj instanceof t.nodeClass);
      }
      if (!tagObj) {
        const name = obj?.constructor?.name ?? (obj === null ? "null" : typeof obj);
        throw new Error(`Tag not resolved for ${name} value`);
      }
      return tagObj;
    }
    function stringifyProps(node, tagObj, { anchors: anchors$1, doc }) {
      if (!doc.directives)
        return "";
      const props = [];
      const anchor = (identity.isScalar(node) || identity.isCollection(node)) && node.anchor;
      if (anchor && anchors.anchorIsValid(anchor)) {
        anchors$1.add(anchor);
        props.push(`&${anchor}`);
      }
      const tag = node.tag ?? (tagObj.default ? null : tagObj.tag);
      if (tag)
        props.push(doc.directives.tagString(tag));
      return props.join(" ");
    }
    function stringify2(item, ctx, onComment, onChompKeep) {
      if (identity.isPair(item))
        return item.toString(ctx, onComment, onChompKeep);
      if (identity.isAlias(item)) {
        if (ctx.doc.directives)
          return item.toString(ctx);
        if (ctx.resolvedAliases?.has(item)) {
          throw new TypeError(`Cannot stringify circular structure without alias nodes`);
        } else {
          if (ctx.resolvedAliases)
            ctx.resolvedAliases.add(item);
          else
            ctx.resolvedAliases = /* @__PURE__ */ new Set([item]);
          item = item.resolve(ctx.doc);
        }
      }
      let tagObj = void 0;
      const node = identity.isNode(item) ? item : ctx.doc.createNode(item, { onTagObj: (o) => tagObj = o });
      tagObj ?? (tagObj = getTagObject(ctx.doc.schema.tags, node));
      const props = stringifyProps(node, tagObj, ctx);
      if (props.length > 0)
        ctx.indentAtStart = (ctx.indentAtStart ?? 0) + props.length + 1;
      const str5 = typeof tagObj.stringify === "function" ? tagObj.stringify(node, ctx, onComment, onChompKeep) : identity.isScalar(node) ? stringifyString.stringifyString(node, ctx, onComment, onChompKeep) : node.toString(ctx, onComment, onChompKeep);
      if (!props)
        return str5;
      return identity.isScalar(node) || str5[0] === "{" || str5[0] === "[" ? `${props} ${str5}` : `${props}
${ctx.indent}${str5}`;
    }
    exports2.createStringifyContext = createStringifyContext;
    exports2.stringify = stringify2;
  }
});

// node_modules/yaml/dist/stringify/stringifyPair.js
var require_stringifyPair = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyPair.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var stringify2 = require_stringify();
    var stringifyComment = require_stringifyComment();
    function stringifyPair({ key, value }, ctx, onComment, onChompKeep) {
      const { allNullValues, doc, indent, indentStep, options: { commentString, indentSeq, simpleKeys } } = ctx;
      let keyComment = identity.isNode(key) && key.comment || null;
      if (simpleKeys) {
        if (keyComment) {
          throw new Error("With simple keys, key nodes cannot have comments");
        }
        if (identity.isCollection(key) || !identity.isNode(key) && typeof key === "object") {
          const msg = "With simple keys, collection cannot be used as a key value";
          throw new Error(msg);
        }
      }
      let explicitKey = !simpleKeys && (!key || keyComment && value == null && !ctx.inFlow || identity.isCollection(key) || (identity.isScalar(key) ? key.type === Scalar.Scalar.BLOCK_FOLDED || key.type === Scalar.Scalar.BLOCK_LITERAL : typeof key === "object"));
      ctx = Object.assign({}, ctx, {
        allNullValues: false,
        implicitKey: !explicitKey && (simpleKeys || !allNullValues),
        indent: indent + indentStep
      });
      let keyCommentDone = false;
      let chompKeep = false;
      let str5 = stringify2.stringify(key, ctx, () => keyCommentDone = true, () => chompKeep = true);
      if (!explicitKey && !ctx.inFlow && str5.length > 1024) {
        if (simpleKeys)
          throw new Error("With simple keys, single line scalar must not span more than 1024 characters");
        explicitKey = true;
      }
      if (ctx.inFlow) {
        if (allNullValues || value == null) {
          if (keyCommentDone && onComment)
            onComment();
          return str5 === "" ? "?" : explicitKey ? `? ${str5}` : str5;
        }
      } else if (allNullValues && !simpleKeys || value == null && explicitKey) {
        str5 = `? ${str5}`;
        if (keyComment && !keyCommentDone) {
          str5 += stringifyComment.lineComment(str5, ctx.indent, commentString(keyComment));
        } else if (chompKeep && onChompKeep)
          onChompKeep();
        return str5;
      }
      if (keyCommentDone)
        keyComment = null;
      if (explicitKey) {
        if (keyComment)
          str5 += stringifyComment.lineComment(str5, ctx.indent, commentString(keyComment));
        str5 = `? ${str5}
${indent}:`;
      } else {
        str5 = `${str5}:`;
        if (keyComment)
          str5 += stringifyComment.lineComment(str5, ctx.indent, commentString(keyComment));
      }
      let vsb, vcb, valueComment;
      if (identity.isNode(value)) {
        vsb = !!value.spaceBefore;
        vcb = value.commentBefore;
        valueComment = value.comment;
      } else {
        vsb = false;
        vcb = null;
        valueComment = null;
        if (value && typeof value === "object")
          value = doc.createNode(value);
      }
      ctx.implicitKey = false;
      if (!explicitKey && !keyComment && identity.isScalar(value))
        ctx.indentAtStart = str5.length + 1;
      chompKeep = false;
      if (!indentSeq && indentStep.length >= 2 && !ctx.inFlow && !explicitKey && identity.isSeq(value) && !value.flow && !value.tag && !value.anchor) {
        ctx.indent = ctx.indent.substring(2);
      }
      let valueCommentDone = false;
      const valueStr = stringify2.stringify(value, ctx, () => valueCommentDone = true, () => chompKeep = true);
      let ws = " ";
      if (keyComment || vsb || vcb) {
        ws = vsb ? "\n" : "";
        if (vcb) {
          const cs = commentString(vcb);
          ws += `
${stringifyComment.indentComment(cs, ctx.indent)}`;
        }
        if (valueStr === "" && !ctx.inFlow) {
          if (ws === "\n" && valueComment)
            ws = "\n\n";
        } else {
          ws += `
${ctx.indent}`;
        }
      } else if (!explicitKey && identity.isCollection(value)) {
        const vs0 = valueStr[0];
        const nl0 = valueStr.indexOf("\n");
        const hasNewline = nl0 !== -1;
        const flow = ctx.inFlow ?? value.flow ?? value.items.length === 0;
        if (hasNewline || !flow) {
          let hasPropsLine = false;
          if (hasNewline && (vs0 === "&" || vs0 === "!")) {
            let sp0 = valueStr.indexOf(" ");
            if (vs0 === "&" && sp0 !== -1 && sp0 < nl0 && valueStr[sp0 + 1] === "!") {
              sp0 = valueStr.indexOf(" ", sp0 + 1);
            }
            if (sp0 === -1 || nl0 < sp0)
              hasPropsLine = true;
          }
          if (!hasPropsLine)
            ws = `
${ctx.indent}`;
        }
      } else if (valueStr === "" || valueStr[0] === "\n") {
        ws = "";
      }
      str5 += ws + valueStr;
      if (ctx.inFlow) {
        if (valueCommentDone && onComment)
          onComment();
      } else if (valueComment && !valueCommentDone) {
        str5 += stringifyComment.lineComment(str5, ctx.indent, commentString(valueComment));
      } else if (chompKeep && onChompKeep) {
        onChompKeep();
      }
      return str5;
    }
    exports2.stringifyPair = stringifyPair;
  }
});

// node_modules/yaml/dist/log.js
var require_log = __commonJS({
  "node_modules/yaml/dist/log.js"(exports2) {
    "use strict";
    var node_process = require("process");
    function debug(logLevel, ...messages) {
      if (logLevel === "debug")
        console.log(...messages);
    }
    function warn(logLevel, warning) {
      if (logLevel === "debug" || logLevel === "warn") {
        if (typeof node_process.emitWarning === "function")
          node_process.emitWarning(warning);
        else
          console.warn(warning);
      }
    }
    exports2.debug = debug;
    exports2.warn = warn;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/merge.js
var require_merge = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/merge.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var MERGE_KEY = "<<";
    var merge = {
      identify: (value) => value === MERGE_KEY || typeof value === "symbol" && value.description === MERGE_KEY,
      default: "key",
      tag: "tag:yaml.org,2002:merge",
      test: /^<<$/,
      resolve: () => Object.assign(new Scalar.Scalar(Symbol(MERGE_KEY)), {
        addToJSMap: addMergeToJSMap
      }),
      stringify: () => MERGE_KEY
    };
    var isMergeKey = (ctx, key) => (merge.identify(key) || identity.isScalar(key) && (!key.type || key.type === Scalar.Scalar.PLAIN) && merge.identify(key.value)) && ctx?.doc.schema.tags.some((tag) => tag.tag === merge.tag && tag.default);
    function addMergeToJSMap(ctx, map, value) {
      const source = resolveAliasValue(ctx, value);
      if (identity.isSeq(source))
        for (const it of source.items)
          mergeValue(ctx, map, it);
      else if (Array.isArray(source))
        for (const it of source)
          mergeValue(ctx, map, it);
      else
        mergeValue(ctx, map, source);
    }
    function mergeValue(ctx, map, value) {
      const source = resolveAliasValue(ctx, value);
      if (!identity.isMap(source))
        throw new Error("Merge sources must be maps or map aliases");
      const srcMap = source.toJSON(null, ctx, Map);
      for (const [key, value2] of srcMap) {
        if (map instanceof Map) {
          if (!map.has(key))
            map.set(key, value2);
        } else if (map instanceof Set) {
          map.add(key);
        } else if (!Object.prototype.hasOwnProperty.call(map, key)) {
          Object.defineProperty(map, key, {
            value: value2,
            writable: true,
            enumerable: true,
            configurable: true
          });
        }
      }
      return map;
    }
    function resolveAliasValue(ctx, value) {
      return ctx && identity.isAlias(value) ? value.resolve(ctx.doc, ctx) : value;
    }
    exports2.addMergeToJSMap = addMergeToJSMap;
    exports2.isMergeKey = isMergeKey;
    exports2.merge = merge;
  }
});

// node_modules/yaml/dist/nodes/addPairToJSMap.js
var require_addPairToJSMap = __commonJS({
  "node_modules/yaml/dist/nodes/addPairToJSMap.js"(exports2) {
    "use strict";
    var log = require_log();
    var merge = require_merge();
    var stringify2 = require_stringify();
    var identity = require_identity();
    var toJS = require_toJS();
    function addPairToJSMap(ctx, map, { key, value }) {
      if (identity.isNode(key) && key.addToJSMap)
        key.addToJSMap(ctx, map, value);
      else if (merge.isMergeKey(ctx, key))
        merge.addMergeToJSMap(ctx, map, value);
      else {
        const jsKey = toJS.toJS(key, "", ctx);
        if (map instanceof Map) {
          map.set(jsKey, toJS.toJS(value, jsKey, ctx));
        } else if (map instanceof Set) {
          map.add(jsKey);
        } else {
          const stringKey = stringifyKey(key, jsKey, ctx);
          const jsValue = toJS.toJS(value, stringKey, ctx);
          if (stringKey in map)
            Object.defineProperty(map, stringKey, {
              value: jsValue,
              writable: true,
              enumerable: true,
              configurable: true
            });
          else
            map[stringKey] = jsValue;
        }
      }
      return map;
    }
    function stringifyKey(key, jsKey, ctx) {
      if (jsKey === null)
        return "";
      if (typeof jsKey !== "object")
        return String(jsKey);
      if (identity.isNode(key) && ctx?.doc) {
        const strCtx = stringify2.createStringifyContext(ctx.doc, {});
        strCtx.anchors = /* @__PURE__ */ new Set();
        for (const node of ctx.anchors.keys())
          strCtx.anchors.add(node.anchor);
        strCtx.inFlow = true;
        strCtx.inStringifyKey = true;
        const strKey = key.toString(strCtx);
        if (!ctx.mapKeyWarned) {
          let jsonStr = JSON.stringify(strKey);
          if (jsonStr.length > 40)
            jsonStr = jsonStr.substring(0, 36) + '..."';
          log.warn(ctx.doc.options.logLevel, `Keys with collection values will be stringified due to JS Object restrictions: ${jsonStr}. Set mapAsMap: true to use object keys.`);
          ctx.mapKeyWarned = true;
        }
        return strKey;
      }
      return JSON.stringify(jsKey);
    }
    exports2.addPairToJSMap = addPairToJSMap;
  }
});

// node_modules/yaml/dist/nodes/Pair.js
var require_Pair = __commonJS({
  "node_modules/yaml/dist/nodes/Pair.js"(exports2) {
    "use strict";
    var createNode = require_createNode();
    var stringifyPair = require_stringifyPair();
    var addPairToJSMap = require_addPairToJSMap();
    var identity = require_identity();
    function createPair(key, value, ctx) {
      const k = createNode.createNode(key, void 0, ctx);
      const v = createNode.createNode(value, void 0, ctx);
      return new Pair(k, v);
    }
    var Pair = class _Pair {
      constructor(key, value = null) {
        Object.defineProperty(this, identity.NODE_TYPE, { value: identity.PAIR });
        this.key = key;
        this.value = value;
      }
      clone(schema) {
        let { key, value } = this;
        if (identity.isNode(key))
          key = key.clone(schema);
        if (identity.isNode(value))
          value = value.clone(schema);
        return new _Pair(key, value);
      }
      toJSON(_, ctx) {
        const pair = ctx?.mapAsMap ? /* @__PURE__ */ new Map() : {};
        return addPairToJSMap.addPairToJSMap(ctx, pair, this);
      }
      toString(ctx, onComment, onChompKeep) {
        return ctx?.doc ? stringifyPair.stringifyPair(this, ctx, onComment, onChompKeep) : JSON.stringify(this);
      }
    };
    exports2.Pair = Pair;
    exports2.createPair = createPair;
  }
});

// node_modules/yaml/dist/stringify/stringifyCollection.js
var require_stringifyCollection = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyCollection.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var stringify2 = require_stringify();
    var stringifyComment = require_stringifyComment();
    function stringifyCollection(collection, ctx, options) {
      const flow = ctx.inFlow ?? collection.flow;
      const stringify3 = flow ? stringifyFlowCollection : stringifyBlockCollection;
      return stringify3(collection, ctx, options);
    }
    function stringifyBlockCollection({ comment, items }, ctx, { blockItemPrefix, flowChars, itemIndent, onChompKeep, onComment }) {
      const { indent, options: { commentString } } = ctx;
      const itemCtx = Object.assign({}, ctx, { indent: itemIndent, type: null });
      let chompKeep = false;
      const lines = [];
      for (let i = 0; i < items.length; ++i) {
        const item = items[i];
        let comment2 = null;
        if (identity.isNode(item)) {
          if (!chompKeep && item.spaceBefore)
            lines.push("");
          addCommentBefore(ctx, lines, item.commentBefore, chompKeep);
          if (item.comment)
            comment2 = item.comment;
        } else if (identity.isPair(item)) {
          const ik = identity.isNode(item.key) ? item.key : null;
          if (ik) {
            if (!chompKeep && ik.spaceBefore)
              lines.push("");
            addCommentBefore(ctx, lines, ik.commentBefore, chompKeep);
          }
        }
        chompKeep = false;
        let str6 = stringify2.stringify(item, itemCtx, () => comment2 = null, () => chompKeep = true);
        if (comment2)
          str6 += stringifyComment.lineComment(str6, itemIndent, commentString(comment2));
        if (chompKeep && comment2)
          chompKeep = false;
        lines.push(blockItemPrefix + str6);
      }
      let str5;
      if (lines.length === 0) {
        str5 = flowChars.start + flowChars.end;
      } else {
        str5 = lines[0];
        for (let i = 1; i < lines.length; ++i) {
          const line = lines[i];
          str5 += line ? `
${indent}${line}` : "\n";
        }
      }
      if (comment) {
        str5 += "\n" + stringifyComment.indentComment(commentString(comment), indent);
        if (onComment)
          onComment();
      } else if (chompKeep && onChompKeep)
        onChompKeep();
      return str5;
    }
    function stringifyFlowCollection({ items }, ctx, { flowChars, itemIndent }) {
      const { indent, indentStep, flowCollectionPadding: fcPadding, options: { commentString } } = ctx;
      itemIndent += indentStep;
      const itemCtx = Object.assign({}, ctx, {
        indent: itemIndent,
        inFlow: true,
        type: null
      });
      let reqNewline = false;
      let linesAtValue = 0;
      const lines = [];
      for (let i = 0; i < items.length; ++i) {
        const item = items[i];
        let comment = null;
        if (identity.isNode(item)) {
          if (item.spaceBefore)
            lines.push("");
          addCommentBefore(ctx, lines, item.commentBefore, false);
          if (item.comment)
            comment = item.comment;
        } else if (identity.isPair(item)) {
          const ik = identity.isNode(item.key) ? item.key : null;
          if (ik) {
            if (ik.spaceBefore)
              lines.push("");
            addCommentBefore(ctx, lines, ik.commentBefore, false);
            if (ik.comment)
              reqNewline = true;
          }
          const iv = identity.isNode(item.value) ? item.value : null;
          if (iv) {
            if (iv.comment)
              comment = iv.comment;
            if (iv.commentBefore)
              reqNewline = true;
          } else if (item.value == null && ik?.comment) {
            comment = ik.comment;
          }
        }
        if (comment)
          reqNewline = true;
        let str5 = stringify2.stringify(item, itemCtx, () => comment = null);
        reqNewline || (reqNewline = lines.length > linesAtValue || str5.includes("\n"));
        if (i < items.length - 1) {
          str5 += ",";
        } else if (ctx.options.trailingComma) {
          if (ctx.options.lineWidth > 0) {
            reqNewline || (reqNewline = lines.reduce((sum, line) => sum + line.length + 2, 2) + (str5.length + 2) > ctx.options.lineWidth);
          }
          if (reqNewline) {
            str5 += ",";
          }
        }
        if (comment)
          str5 += stringifyComment.lineComment(str5, itemIndent, commentString(comment));
        lines.push(str5);
        linesAtValue = lines.length;
      }
      const { start, end } = flowChars;
      if (lines.length === 0) {
        return start + end;
      } else {
        if (!reqNewline) {
          const len = lines.reduce((sum, line) => sum + line.length + 2, 2);
          reqNewline = ctx.options.lineWidth > 0 && len > ctx.options.lineWidth;
        }
        if (reqNewline) {
          let str5 = start;
          for (const line of lines)
            str5 += line ? `
${indentStep}${indent}${line}` : "\n";
          return `${str5}
${indent}${end}`;
        } else {
          return `${start}${fcPadding}${lines.join(" ")}${fcPadding}${end}`;
        }
      }
    }
    function addCommentBefore({ indent, options: { commentString } }, lines, comment, chompKeep) {
      if (comment && chompKeep)
        comment = comment.replace(/^\n+/, "");
      if (comment) {
        const ic = stringifyComment.indentComment(commentString(comment), indent);
        lines.push(ic.trimStart());
      }
    }
    exports2.stringifyCollection = stringifyCollection;
  }
});

// node_modules/yaml/dist/nodes/YAMLMap.js
var require_YAMLMap = __commonJS({
  "node_modules/yaml/dist/nodes/YAMLMap.js"(exports2) {
    "use strict";
    var stringifyCollection = require_stringifyCollection();
    var addPairToJSMap = require_addPairToJSMap();
    var Collection = require_Collection();
    var identity = require_identity();
    var Pair = require_Pair();
    var Scalar = require_Scalar();
    function findPair(items, key) {
      const k = identity.isScalar(key) ? key.value : key;
      for (const it of items) {
        if (identity.isPair(it)) {
          if (it.key === key || it.key === k)
            return it;
          if (identity.isScalar(it.key) && it.key.value === k)
            return it;
        }
      }
      return void 0;
    }
    var YAMLMap = class extends Collection.Collection {
      static get tagName() {
        return "tag:yaml.org,2002:map";
      }
      constructor(schema) {
        super(identity.MAP, schema);
        this.items = [];
      }
      /**
       * A generic collection parsing method that can be extended
       * to other node classes that inherit from YAMLMap
       */
      static from(schema, obj, ctx) {
        const { keepUndefined, replacer } = ctx;
        const map = new this(schema);
        const add = (key, value) => {
          if (typeof replacer === "function")
            value = replacer.call(obj, key, value);
          else if (Array.isArray(replacer) && !replacer.includes(key))
            return;
          if (value !== void 0 || keepUndefined)
            map.items.push(Pair.createPair(key, value, ctx));
        };
        if (obj instanceof Map) {
          for (const [key, value] of obj)
            add(key, value);
        } else if (obj && typeof obj === "object") {
          for (const key of Object.keys(obj))
            add(key, obj[key]);
        }
        if (typeof schema.sortMapEntries === "function") {
          map.items.sort(schema.sortMapEntries);
        }
        return map;
      }
      /**
       * Adds a value to the collection.
       *
       * @param overwrite - If not set `true`, using a key that is already in the
       *   collection will throw. Otherwise, overwrites the previous value.
       */
      add(pair, overwrite) {
        let _pair;
        if (identity.isPair(pair))
          _pair = pair;
        else if (!pair || typeof pair !== "object" || !("key" in pair)) {
          _pair = new Pair.Pair(pair, pair?.value);
        } else
          _pair = new Pair.Pair(pair.key, pair.value);
        const prev = findPair(this.items, _pair.key);
        const sortEntries = this.schema?.sortMapEntries;
        if (prev) {
          if (!overwrite)
            throw new Error(`Key ${_pair.key} already set`);
          if (identity.isScalar(prev.value) && Scalar.isScalarValue(_pair.value))
            prev.value.value = _pair.value;
          else
            prev.value = _pair.value;
        } else if (sortEntries) {
          const i = this.items.findIndex((item) => sortEntries(_pair, item) < 0);
          if (i === -1)
            this.items.push(_pair);
          else
            this.items.splice(i, 0, _pair);
        } else {
          this.items.push(_pair);
        }
      }
      delete(key) {
        const it = findPair(this.items, key);
        if (!it)
          return false;
        const del = this.items.splice(this.items.indexOf(it), 1);
        return del.length > 0;
      }
      get(key, keepScalar) {
        const it = findPair(this.items, key);
        const node = it?.value;
        return (!keepScalar && identity.isScalar(node) ? node.value : node) ?? void 0;
      }
      has(key) {
        return !!findPair(this.items, key);
      }
      set(key, value) {
        this.add(new Pair.Pair(key, value), true);
      }
      /**
       * @param ctx - Conversion context, originally set in Document#toJS()
       * @param {Class} Type - If set, forces the returned collection type
       * @returns Instance of Type, Map, or Object
       */
      toJSON(_, ctx, Type) {
        const map = Type ? new Type() : ctx?.mapAsMap ? /* @__PURE__ */ new Map() : {};
        if (ctx?.onCreate)
          ctx.onCreate(map);
        for (const item of this.items)
          addPairToJSMap.addPairToJSMap(ctx, map, item);
        return map;
      }
      toString(ctx, onComment, onChompKeep) {
        if (!ctx)
          return JSON.stringify(this);
        for (const item of this.items) {
          if (!identity.isPair(item))
            throw new Error(`Map items must all be pairs; found ${JSON.stringify(item)} instead`);
        }
        if (!ctx.allNullValues && this.hasAllNullValues(false))
          ctx = Object.assign({}, ctx, { allNullValues: true });
        return stringifyCollection.stringifyCollection(this, ctx, {
          blockItemPrefix: "",
          flowChars: { start: "{", end: "}" },
          itemIndent: ctx.indent || "",
          onChompKeep,
          onComment
        });
      }
    };
    exports2.YAMLMap = YAMLMap;
    exports2.findPair = findPair;
  }
});

// node_modules/yaml/dist/schema/common/map.js
var require_map = __commonJS({
  "node_modules/yaml/dist/schema/common/map.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var YAMLMap = require_YAMLMap();
    var map = {
      collection: "map",
      default: true,
      nodeClass: YAMLMap.YAMLMap,
      tag: "tag:yaml.org,2002:map",
      resolve(map2, onError) {
        if (!identity.isMap(map2))
          onError("Expected a mapping for this tag");
        return map2;
      },
      createNode: (schema, obj, ctx) => YAMLMap.YAMLMap.from(schema, obj, ctx)
    };
    exports2.map = map;
  }
});

// node_modules/yaml/dist/nodes/YAMLSeq.js
var require_YAMLSeq = __commonJS({
  "node_modules/yaml/dist/nodes/YAMLSeq.js"(exports2) {
    "use strict";
    var createNode = require_createNode();
    var stringifyCollection = require_stringifyCollection();
    var Collection = require_Collection();
    var identity = require_identity();
    var Scalar = require_Scalar();
    var toJS = require_toJS();
    var YAMLSeq = class extends Collection.Collection {
      static get tagName() {
        return "tag:yaml.org,2002:seq";
      }
      constructor(schema) {
        super(identity.SEQ, schema);
        this.items = [];
      }
      add(value) {
        this.items.push(value);
      }
      /**
       * Removes a value from the collection.
       *
       * `key` must contain a representation of an integer for this to succeed.
       * It may be wrapped in a `Scalar`.
       *
       * @returns `true` if the item was found and removed.
       */
      delete(key) {
        const idx = asItemIndex(key);
        if (typeof idx !== "number")
          return false;
        const del = this.items.splice(idx, 1);
        return del.length > 0;
      }
      get(key, keepScalar) {
        const idx = asItemIndex(key);
        if (typeof idx !== "number")
          return void 0;
        const it = this.items[idx];
        return !keepScalar && identity.isScalar(it) ? it.value : it;
      }
      /**
       * Checks if the collection includes a value with the key `key`.
       *
       * `key` must contain a representation of an integer for this to succeed.
       * It may be wrapped in a `Scalar`.
       */
      has(key) {
        const idx = asItemIndex(key);
        return typeof idx === "number" && idx < this.items.length;
      }
      /**
       * Sets a value in this collection. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       *
       * If `key` does not contain a representation of an integer, this will throw.
       * It may be wrapped in a `Scalar`.
       */
      set(key, value) {
        const idx = asItemIndex(key);
        if (typeof idx !== "number")
          throw new Error(`Expected a valid index, not ${key}.`);
        const prev = this.items[idx];
        if (identity.isScalar(prev) && Scalar.isScalarValue(value))
          prev.value = value;
        else
          this.items[idx] = value;
      }
      toJSON(_, ctx) {
        const seq = [];
        if (ctx?.onCreate)
          ctx.onCreate(seq);
        let i = 0;
        for (const item of this.items)
          seq.push(toJS.toJS(item, String(i++), ctx));
        return seq;
      }
      toString(ctx, onComment, onChompKeep) {
        if (!ctx)
          return JSON.stringify(this);
        return stringifyCollection.stringifyCollection(this, ctx, {
          blockItemPrefix: "- ",
          flowChars: { start: "[", end: "]" },
          itemIndent: (ctx.indent || "") + "  ",
          onChompKeep,
          onComment
        });
      }
      static from(schema, obj, ctx) {
        const { replacer } = ctx;
        const seq = new this(schema);
        if (obj && Symbol.iterator in Object(obj)) {
          let i = 0;
          for (let it of obj) {
            if (typeof replacer === "function") {
              const key = obj instanceof Set ? it : String(i++);
              it = replacer.call(obj, key, it);
            }
            seq.items.push(createNode.createNode(it, void 0, ctx));
          }
        }
        return seq;
      }
    };
    function asItemIndex(key) {
      let idx = identity.isScalar(key) ? key.value : key;
      if (idx && typeof idx === "string")
        idx = Number(idx);
      return typeof idx === "number" && Number.isInteger(idx) && idx >= 0 ? idx : null;
    }
    exports2.YAMLSeq = YAMLSeq;
  }
});

// node_modules/yaml/dist/schema/common/seq.js
var require_seq = __commonJS({
  "node_modules/yaml/dist/schema/common/seq.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var YAMLSeq = require_YAMLSeq();
    var seq = {
      collection: "seq",
      default: true,
      nodeClass: YAMLSeq.YAMLSeq,
      tag: "tag:yaml.org,2002:seq",
      resolve(seq2, onError) {
        if (!identity.isSeq(seq2))
          onError("Expected a sequence for this tag");
        return seq2;
      },
      createNode: (schema, obj, ctx) => YAMLSeq.YAMLSeq.from(schema, obj, ctx)
    };
    exports2.seq = seq;
  }
});

// node_modules/yaml/dist/schema/common/string.js
var require_string = __commonJS({
  "node_modules/yaml/dist/schema/common/string.js"(exports2) {
    "use strict";
    var stringifyString = require_stringifyString();
    var string = {
      identify: (value) => typeof value === "string",
      default: true,
      tag: "tag:yaml.org,2002:str",
      resolve: (str5) => str5,
      stringify(item, ctx, onComment, onChompKeep) {
        ctx = Object.assign({ actualString: true }, ctx);
        return stringifyString.stringifyString(item, ctx, onComment, onChompKeep);
      }
    };
    exports2.string = string;
  }
});

// node_modules/yaml/dist/schema/common/null.js
var require_null = __commonJS({
  "node_modules/yaml/dist/schema/common/null.js"(exports2) {
    "use strict";
    var Scalar = require_Scalar();
    var nullTag = {
      identify: (value) => value == null,
      createNode: () => new Scalar.Scalar(null),
      default: true,
      tag: "tag:yaml.org,2002:null",
      test: /^(?:~|[Nn]ull|NULL)?$/,
      resolve: () => new Scalar.Scalar(null),
      stringify: ({ source }, ctx) => typeof source === "string" && nullTag.test.test(source) ? source : ctx.options.nullStr
    };
    exports2.nullTag = nullTag;
  }
});

// node_modules/yaml/dist/schema/core/bool.js
var require_bool = __commonJS({
  "node_modules/yaml/dist/schema/core/bool.js"(exports2) {
    "use strict";
    var Scalar = require_Scalar();
    var boolTag = {
      identify: (value) => typeof value === "boolean",
      default: true,
      tag: "tag:yaml.org,2002:bool",
      test: /^(?:[Tt]rue|TRUE|[Ff]alse|FALSE)$/,
      resolve: (str5) => new Scalar.Scalar(str5[0] === "t" || str5[0] === "T"),
      stringify({ source, value }, ctx) {
        if (source && boolTag.test.test(source)) {
          const sv = source[0] === "t" || source[0] === "T";
          if (value === sv)
            return source;
        }
        return value ? ctx.options.trueStr : ctx.options.falseStr;
      }
    };
    exports2.boolTag = boolTag;
  }
});

// node_modules/yaml/dist/stringify/stringifyNumber.js
var require_stringifyNumber = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyNumber.js"(exports2) {
    "use strict";
    function stringifyNumber({ format, minFractionDigits, tag, value }) {
      if (typeof value === "bigint")
        return String(value);
      const num3 = typeof value === "number" ? value : Number(value);
      if (!isFinite(num3))
        return isNaN(num3) ? ".nan" : num3 < 0 ? "-.inf" : ".inf";
      let n = Object.is(value, -0) ? "-0" : JSON.stringify(value);
      if (!format && minFractionDigits && (!tag || tag === "tag:yaml.org,2002:float") && /^-?\d/.test(n) && !n.includes("e")) {
        let i = n.indexOf(".");
        if (i < 0) {
          i = n.length;
          n += ".";
        }
        let d = minFractionDigits - (n.length - i - 1);
        while (d-- > 0)
          n += "0";
      }
      return n;
    }
    exports2.stringifyNumber = stringifyNumber;
  }
});

// node_modules/yaml/dist/schema/core/float.js
var require_float = __commonJS({
  "node_modules/yaml/dist/schema/core/float.js"(exports2) {
    "use strict";
    var Scalar = require_Scalar();
    var stringifyNumber = require_stringifyNumber();
    var floatNaN = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
      resolve: (str5) => str5.slice(-3).toLowerCase() === "nan" ? NaN : str5[0] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
      stringify: stringifyNumber.stringifyNumber
    };
    var floatExp = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      format: "EXP",
      test: /^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)[eE][-+]?[0-9]+$/,
      resolve: (str5) => parseFloat(str5),
      stringify(node) {
        const num3 = Number(node.value);
        return isFinite(num3) ? num3.toExponential() : stringifyNumber.stringifyNumber(node);
      }
    };
    var float = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^[-+]?(?:\.[0-9]+|[0-9]+\.[0-9]*)$/,
      resolve(str5) {
        const node = new Scalar.Scalar(parseFloat(str5));
        const dot = str5.indexOf(".");
        if (dot !== -1 && str5[str5.length - 1] === "0")
          node.minFractionDigits = str5.length - dot - 1;
        return node;
      },
      stringify: stringifyNumber.stringifyNumber
    };
    exports2.float = float;
    exports2.floatExp = floatExp;
    exports2.floatNaN = floatNaN;
  }
});

// node_modules/yaml/dist/schema/core/int.js
var require_int = __commonJS({
  "node_modules/yaml/dist/schema/core/int.js"(exports2) {
    "use strict";
    var stringifyNumber = require_stringifyNumber();
    var intIdentify = (value) => typeof value === "bigint" || Number.isInteger(value);
    var intResolve = (str5, offset, radix, { intAsBigInt }) => intAsBigInt ? BigInt(str5) : parseInt(str5.substring(offset), radix);
    function intStringify(node, radix, prefix) {
      const { value } = node;
      if (intIdentify(value) && value >= 0)
        return prefix + value.toString(radix);
      return stringifyNumber.stringifyNumber(node);
    }
    var intOct = {
      identify: (value) => intIdentify(value) && value >= 0,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "OCT",
      test: /^0o[0-7]+$/,
      resolve: (str5, _onError, opt) => intResolve(str5, 2, 8, opt),
      stringify: (node) => intStringify(node, 8, "0o")
    };
    var int2 = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      test: /^[-+]?[0-9]+$/,
      resolve: (str5, _onError, opt) => intResolve(str5, 0, 10, opt),
      stringify: stringifyNumber.stringifyNumber
    };
    var intHex = {
      identify: (value) => intIdentify(value) && value >= 0,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "HEX",
      test: /^0x[0-9a-fA-F]+$/,
      resolve: (str5, _onError, opt) => intResolve(str5, 2, 16, opt),
      stringify: (node) => intStringify(node, 16, "0x")
    };
    exports2.int = int2;
    exports2.intHex = intHex;
    exports2.intOct = intOct;
  }
});

// node_modules/yaml/dist/schema/core/schema.js
var require_schema = __commonJS({
  "node_modules/yaml/dist/schema/core/schema.js"(exports2) {
    "use strict";
    var map = require_map();
    var _null = require_null();
    var seq = require_seq();
    var string = require_string();
    var bool = require_bool();
    var float = require_float();
    var int2 = require_int();
    var schema = [
      map.map,
      seq.seq,
      string.string,
      _null.nullTag,
      bool.boolTag,
      int2.intOct,
      int2.int,
      int2.intHex,
      float.floatNaN,
      float.floatExp,
      float.float
    ];
    exports2.schema = schema;
  }
});

// node_modules/yaml/dist/schema/json/schema.js
var require_schema2 = __commonJS({
  "node_modules/yaml/dist/schema/json/schema.js"(exports2) {
    "use strict";
    var Scalar = require_Scalar();
    var map = require_map();
    var seq = require_seq();
    function intIdentify(value) {
      return typeof value === "bigint" || Number.isInteger(value);
    }
    var stringifyJSON = ({ value }) => JSON.stringify(value);
    var jsonScalars = [
      {
        identify: (value) => typeof value === "string",
        default: true,
        tag: "tag:yaml.org,2002:str",
        resolve: (str5) => str5,
        stringify: stringifyJSON
      },
      {
        identify: (value) => value == null,
        createNode: () => new Scalar.Scalar(null),
        default: true,
        tag: "tag:yaml.org,2002:null",
        test: /^null$/,
        resolve: () => null,
        stringify: stringifyJSON
      },
      {
        identify: (value) => typeof value === "boolean",
        default: true,
        tag: "tag:yaml.org,2002:bool",
        test: /^true$|^false$/,
        resolve: (str5) => str5 === "true",
        stringify: stringifyJSON
      },
      {
        identify: intIdentify,
        default: true,
        tag: "tag:yaml.org,2002:int",
        test: /^-?(?:0|[1-9][0-9]*)$/,
        resolve: (str5, _onError, { intAsBigInt }) => intAsBigInt ? BigInt(str5) : parseInt(str5, 10),
        stringify: ({ value }) => intIdentify(value) ? value.toString() : JSON.stringify(value)
      },
      {
        identify: (value) => typeof value === "number",
        default: true,
        tag: "tag:yaml.org,2002:float",
        test: /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*)?(?:[eE][-+]?[0-9]+)?$/,
        resolve: (str5) => parseFloat(str5),
        stringify: stringifyJSON
      }
    ];
    var jsonError = {
      default: true,
      tag: "",
      test: /^/,
      resolve(str5, onError) {
        onError(`Unresolved plain scalar ${JSON.stringify(str5)}`);
        return str5;
      }
    };
    var schema = [map.map, seq.seq].concat(jsonScalars, jsonError);
    exports2.schema = schema;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/binary.js
var require_binary = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/binary.js"(exports2) {
    "use strict";
    var node_buffer = require("buffer");
    var Scalar = require_Scalar();
    var stringifyString = require_stringifyString();
    var binary = {
      identify: (value) => value instanceof Uint8Array,
      // Buffer inherits from Uint8Array
      default: false,
      tag: "tag:yaml.org,2002:binary",
      /**
       * Returns a Buffer in node and an Uint8Array in browsers
       *
       * To use the resulting buffer as an image, you'll want to do something like:
       *
       *   const blob = new Blob([buffer], { type: 'image/jpeg' })
       *   document.querySelector('#photo').src = URL.createObjectURL(blob)
       */
      resolve(src, onError) {
        if (typeof node_buffer.Buffer === "function") {
          return node_buffer.Buffer.from(src, "base64");
        } else if (typeof atob === "function") {
          const str5 = atob(src.replace(/[\n\r]/g, ""));
          const buffer = new Uint8Array(str5.length);
          for (let i = 0; i < str5.length; ++i)
            buffer[i] = str5.charCodeAt(i);
          return buffer;
        } else {
          onError("This environment does not support reading binary tags; either Buffer or atob is required");
          return src;
        }
      },
      stringify({ comment, type, value }, ctx, onComment, onChompKeep) {
        if (!value)
          return "";
        const buf = value;
        let str5;
        if (typeof node_buffer.Buffer === "function") {
          str5 = buf instanceof node_buffer.Buffer ? buf.toString("base64") : node_buffer.Buffer.from(buf.buffer).toString("base64");
        } else if (typeof btoa === "function") {
          let s2 = "";
          for (let i = 0; i < buf.length; ++i)
            s2 += String.fromCharCode(buf[i]);
          str5 = btoa(s2);
        } else {
          throw new Error("This environment does not support writing binary tags; either Buffer or btoa is required");
        }
        type ?? (type = Scalar.Scalar.BLOCK_LITERAL);
        if (type !== Scalar.Scalar.QUOTE_DOUBLE) {
          const lineWidth = Math.max(ctx.options.lineWidth - ctx.indent.length, ctx.options.minContentWidth);
          const n = Math.ceil(str5.length / lineWidth);
          const lines = new Array(n);
          for (let i = 0, o = 0; i < n; ++i, o += lineWidth) {
            lines[i] = str5.substr(o, lineWidth);
          }
          str5 = lines.join(type === Scalar.Scalar.BLOCK_LITERAL ? "\n" : " ");
        }
        return stringifyString.stringifyString({ comment, type, value: str5 }, ctx, onComment, onChompKeep);
      }
    };
    exports2.binary = binary;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/pairs.js
var require_pairs = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/pairs.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var Pair = require_Pair();
    var Scalar = require_Scalar();
    var YAMLSeq = require_YAMLSeq();
    function resolvePairs(seq, onError) {
      if (identity.isSeq(seq)) {
        for (let i = 0; i < seq.items.length; ++i) {
          let item = seq.items[i];
          if (identity.isPair(item))
            continue;
          else if (identity.isMap(item)) {
            if (item.items.length > 1)
              onError("Each pair must have its own sequence indicator");
            const pair = item.items[0] || new Pair.Pair(new Scalar.Scalar(null));
            if (item.commentBefore)
              pair.key.commentBefore = pair.key.commentBefore ? `${item.commentBefore}
${pair.key.commentBefore}` : item.commentBefore;
            if (item.comment) {
              const cn = pair.value ?? pair.key;
              cn.comment = cn.comment ? `${item.comment}
${cn.comment}` : item.comment;
            }
            item = pair;
          }
          seq.items[i] = identity.isPair(item) ? item : new Pair.Pair(item);
        }
      } else
        onError("Expected a sequence for this tag");
      return seq;
    }
    function createPairs(schema, iterable, ctx) {
      const { replacer } = ctx;
      const pairs2 = new YAMLSeq.YAMLSeq(schema);
      pairs2.tag = "tag:yaml.org,2002:pairs";
      let i = 0;
      if (iterable && Symbol.iterator in Object(iterable))
        for (let it of iterable) {
          if (typeof replacer === "function")
            it = replacer.call(iterable, String(i++), it);
          let key, value;
          if (Array.isArray(it)) {
            if (it.length === 2) {
              key = it[0];
              value = it[1];
            } else
              throw new TypeError(`Expected [key, value] tuple: ${it}`);
          } else if (it && it instanceof Object) {
            const keys = Object.keys(it);
            if (keys.length === 1) {
              key = keys[0];
              value = it[key];
            } else {
              throw new TypeError(`Expected tuple with one key, not ${keys.length} keys`);
            }
          } else {
            key = it;
          }
          pairs2.items.push(Pair.createPair(key, value, ctx));
        }
      return pairs2;
    }
    var pairs = {
      collection: "seq",
      default: false,
      tag: "tag:yaml.org,2002:pairs",
      resolve: resolvePairs,
      createNode: createPairs
    };
    exports2.createPairs = createPairs;
    exports2.pairs = pairs;
    exports2.resolvePairs = resolvePairs;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/omap.js
var require_omap = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/omap.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var toJS = require_toJS();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var pairs = require_pairs();
    var YAMLOMap = class _YAMLOMap extends YAMLSeq.YAMLSeq {
      constructor() {
        super();
        this.add = YAMLMap.YAMLMap.prototype.add.bind(this);
        this.delete = YAMLMap.YAMLMap.prototype.delete.bind(this);
        this.get = YAMLMap.YAMLMap.prototype.get.bind(this);
        this.has = YAMLMap.YAMLMap.prototype.has.bind(this);
        this.set = YAMLMap.YAMLMap.prototype.set.bind(this);
        this.tag = _YAMLOMap.tag;
      }
      /**
       * If `ctx` is given, the return type is actually `Map<unknown, unknown>`,
       * but TypeScript won't allow widening the signature of a child method.
       */
      toJSON(_, ctx) {
        if (!ctx)
          return super.toJSON(_);
        const map = /* @__PURE__ */ new Map();
        if (ctx?.onCreate)
          ctx.onCreate(map);
        for (const pair of this.items) {
          let key, value;
          if (identity.isPair(pair)) {
            key = toJS.toJS(pair.key, "", ctx);
            value = toJS.toJS(pair.value, key, ctx);
          } else {
            key = toJS.toJS(pair, "", ctx);
          }
          if (map.has(key))
            throw new Error("Ordered maps must not include duplicate keys");
          map.set(key, value);
        }
        return map;
      }
      static from(schema, iterable, ctx) {
        const pairs$1 = pairs.createPairs(schema, iterable, ctx);
        const omap2 = new this();
        omap2.items = pairs$1.items;
        return omap2;
      }
    };
    YAMLOMap.tag = "tag:yaml.org,2002:omap";
    var omap = {
      collection: "seq",
      identify: (value) => value instanceof Map,
      nodeClass: YAMLOMap,
      default: false,
      tag: "tag:yaml.org,2002:omap",
      resolve(seq, onError) {
        const pairs$1 = pairs.resolvePairs(seq, onError);
        const seenKeys = [];
        for (const { key } of pairs$1.items) {
          if (identity.isScalar(key)) {
            if (seenKeys.includes(key.value)) {
              onError(`Ordered maps must not include duplicate keys: ${key.value}`);
            } else {
              seenKeys.push(key.value);
            }
          }
        }
        return Object.assign(new YAMLOMap(), pairs$1);
      },
      createNode: (schema, iterable, ctx) => YAMLOMap.from(schema, iterable, ctx)
    };
    exports2.YAMLOMap = YAMLOMap;
    exports2.omap = omap;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/bool.js
var require_bool2 = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/bool.js"(exports2) {
    "use strict";
    var Scalar = require_Scalar();
    function boolStringify({ value, source }, ctx) {
      const boolObj = value ? trueTag : falseTag;
      if (source && boolObj.test.test(source))
        return source;
      return value ? ctx.options.trueStr : ctx.options.falseStr;
    }
    var trueTag = {
      identify: (value) => value === true,
      default: true,
      tag: "tag:yaml.org,2002:bool",
      test: /^(?:Y|y|[Yy]es|YES|[Tt]rue|TRUE|[Oo]n|ON)$/,
      resolve: () => new Scalar.Scalar(true),
      stringify: boolStringify
    };
    var falseTag = {
      identify: (value) => value === false,
      default: true,
      tag: "tag:yaml.org,2002:bool",
      test: /^(?:N|n|[Nn]o|NO|[Ff]alse|FALSE|[Oo]ff|OFF)$/,
      resolve: () => new Scalar.Scalar(false),
      stringify: boolStringify
    };
    exports2.falseTag = falseTag;
    exports2.trueTag = trueTag;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/float.js
var require_float2 = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/float.js"(exports2) {
    "use strict";
    var Scalar = require_Scalar();
    var stringifyNumber = require_stringifyNumber();
    var floatNaN = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
      resolve: (str5) => str5.slice(-3).toLowerCase() === "nan" ? NaN : str5[0] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
      stringify: stringifyNumber.stringifyNumber
    };
    var floatExp = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      format: "EXP",
      test: /^[-+]?(?:[0-9][0-9_]*)?(?:\.[0-9_]*)?[eE][-+]?[0-9]+$/,
      resolve: (str5) => parseFloat(str5.replace(/_/g, "")),
      stringify(node) {
        const num3 = Number(node.value);
        return isFinite(num3) ? num3.toExponential() : stringifyNumber.stringifyNumber(node);
      }
    };
    var float = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^[-+]?(?:[0-9][0-9_]*)?\.[0-9_]*$/,
      resolve(str5) {
        const node = new Scalar.Scalar(parseFloat(str5.replace(/_/g, "")));
        const dot = str5.indexOf(".");
        if (dot !== -1) {
          const f = str5.substring(dot + 1).replace(/_/g, "");
          if (f[f.length - 1] === "0")
            node.minFractionDigits = f.length;
        }
        return node;
      },
      stringify: stringifyNumber.stringifyNumber
    };
    exports2.float = float;
    exports2.floatExp = floatExp;
    exports2.floatNaN = floatNaN;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/int.js
var require_int2 = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/int.js"(exports2) {
    "use strict";
    var stringifyNumber = require_stringifyNumber();
    var intIdentify = (value) => typeof value === "bigint" || Number.isInteger(value);
    function intResolve(str5, offset, radix, { intAsBigInt }) {
      const sign = str5[0];
      if (sign === "-" || sign === "+")
        offset += 1;
      str5 = str5.substring(offset).replace(/_/g, "");
      if (intAsBigInt) {
        switch (radix) {
          case 2:
            str5 = `0b${str5}`;
            break;
          case 8:
            str5 = `0o${str5}`;
            break;
          case 16:
            str5 = `0x${str5}`;
            break;
        }
        const n2 = BigInt(str5);
        return sign === "-" ? BigInt(-1) * n2 : n2;
      }
      const n = parseInt(str5, radix);
      return sign === "-" ? -1 * n : n;
    }
    function intStringify(node, radix, prefix) {
      const { value } = node;
      if (intIdentify(value)) {
        const str5 = value.toString(radix);
        return value < 0 ? "-" + prefix + str5.substr(1) : prefix + str5;
      }
      return stringifyNumber.stringifyNumber(node);
    }
    var intBin = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "BIN",
      test: /^[-+]?0b[0-1_]+$/,
      resolve: (str5, _onError, opt) => intResolve(str5, 2, 2, opt),
      stringify: (node) => intStringify(node, 2, "0b")
    };
    var intOct = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "OCT",
      test: /^[-+]?0[0-7_]+$/,
      resolve: (str5, _onError, opt) => intResolve(str5, 1, 8, opt),
      stringify: (node) => intStringify(node, 8, "0")
    };
    var int2 = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      test: /^[-+]?[0-9][0-9_]*$/,
      resolve: (str5, _onError, opt) => intResolve(str5, 0, 10, opt),
      stringify: stringifyNumber.stringifyNumber
    };
    var intHex = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "HEX",
      test: /^[-+]?0x[0-9a-fA-F_]+$/,
      resolve: (str5, _onError, opt) => intResolve(str5, 2, 16, opt),
      stringify: (node) => intStringify(node, 16, "0x")
    };
    exports2.int = int2;
    exports2.intBin = intBin;
    exports2.intHex = intHex;
    exports2.intOct = intOct;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/set.js
var require_set = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/set.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var Pair = require_Pair();
    var YAMLMap = require_YAMLMap();
    var YAMLSet = class _YAMLSet extends YAMLMap.YAMLMap {
      constructor(schema) {
        super(schema);
        this.tag = _YAMLSet.tag;
      }
      add(key) {
        let pair;
        if (identity.isPair(key))
          pair = key;
        else if (key && typeof key === "object" && "key" in key && "value" in key && key.value === null)
          pair = new Pair.Pair(key.key, null);
        else
          pair = new Pair.Pair(key, null);
        const prev = YAMLMap.findPair(this.items, pair.key);
        if (!prev)
          this.items.push(pair);
      }
      /**
       * If `keepPair` is `true`, returns the Pair matching `key`.
       * Otherwise, returns the value of that Pair's key.
       */
      get(key, keepPair) {
        const pair = YAMLMap.findPair(this.items, key);
        return !keepPair && identity.isPair(pair) ? identity.isScalar(pair.key) ? pair.key.value : pair.key : pair;
      }
      set(key, value) {
        if (typeof value !== "boolean")
          throw new Error(`Expected boolean value for set(key, value) in a YAML set, not ${typeof value}`);
        const prev = YAMLMap.findPair(this.items, key);
        if (prev && !value) {
          this.items.splice(this.items.indexOf(prev), 1);
        } else if (!prev && value) {
          this.items.push(new Pair.Pair(key));
        }
      }
      toJSON(_, ctx) {
        return super.toJSON(_, ctx, Set);
      }
      toString(ctx, onComment, onChompKeep) {
        if (!ctx)
          return JSON.stringify(this);
        if (this.hasAllNullValues(true))
          return super.toString(Object.assign({}, ctx, { allNullValues: true }), onComment, onChompKeep);
        else
          throw new Error("Set items must all have null values");
      }
      static from(schema, iterable, ctx) {
        const { replacer } = ctx;
        const set2 = new this(schema);
        if (iterable && Symbol.iterator in Object(iterable))
          for (let value of iterable) {
            if (typeof replacer === "function")
              value = replacer.call(iterable, value, value);
            set2.items.push(Pair.createPair(value, null, ctx));
          }
        return set2;
      }
    };
    YAMLSet.tag = "tag:yaml.org,2002:set";
    var set = {
      collection: "map",
      identify: (value) => value instanceof Set,
      nodeClass: YAMLSet,
      default: false,
      tag: "tag:yaml.org,2002:set",
      createNode: (schema, iterable, ctx) => YAMLSet.from(schema, iterable, ctx),
      resolve(map, onError) {
        if (identity.isMap(map)) {
          if (map.hasAllNullValues(true))
            return Object.assign(new YAMLSet(), map);
          else
            onError("Set items must all have null values");
        } else
          onError("Expected a mapping for this tag");
        return map;
      }
    };
    exports2.YAMLSet = YAMLSet;
    exports2.set = set;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/timestamp.js
var require_timestamp = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/timestamp.js"(exports2) {
    "use strict";
    var stringifyNumber = require_stringifyNumber();
    function parseSexagesimal(str5, asBigInt) {
      const sign = str5[0];
      const parts = sign === "-" || sign === "+" ? str5.substring(1) : str5;
      const num3 = (n) => asBigInt ? BigInt(n) : Number(n);
      const res = parts.replace(/_/g, "").split(":").reduce((res2, p) => res2 * num3(60) + num3(p), num3(0));
      return sign === "-" ? num3(-1) * res : res;
    }
    function stringifySexagesimal(node) {
      let { value } = node;
      let num3 = (n) => n;
      if (typeof value === "bigint")
        num3 = (n) => BigInt(n);
      else if (isNaN(value) || !isFinite(value))
        return stringifyNumber.stringifyNumber(node);
      let sign = "";
      if (value < 0) {
        sign = "-";
        value *= num3(-1);
      }
      const _60 = num3(60);
      const parts = [value % _60];
      if (value < 60) {
        parts.unshift(0);
      } else {
        value = (value - parts[0]) / _60;
        parts.unshift(value % _60);
        if (value >= 60) {
          value = (value - parts[0]) / _60;
          parts.unshift(value);
        }
      }
      return sign + parts.map((n) => String(n).padStart(2, "0")).join(":").replace(/000000\d*$/, "");
    }
    var intTime = {
      identify: (value) => typeof value === "bigint" || Number.isInteger(value),
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "TIME",
      test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+$/,
      resolve: (str5, _onError, { intAsBigInt }) => parseSexagesimal(str5, intAsBigInt),
      stringify: stringifySexagesimal
    };
    var floatTime = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      format: "TIME",
      test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*$/,
      resolve: (str5) => parseSexagesimal(str5, false),
      stringify: stringifySexagesimal
    };
    var timestamp = {
      identify: (value) => value instanceof Date,
      default: true,
      tag: "tag:yaml.org,2002:timestamp",
      // If the time zone is omitted, the timestamp is assumed to be specified in UTC. The time part
      // may be omitted altogether, resulting in a date format. In such a case, the time part is
      // assumed to be 00:00:00Z (start of day, UTC).
      test: RegExp("^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})(?:(?:t|T|[ \\t]+)([0-9]{1,2}):([0-9]{1,2}):([0-9]{1,2}(\\.[0-9]+)?)(?:[ \\t]*(Z|[-+][012]?[0-9](?::[0-9]{2})?))?)?$"),
      resolve(str5) {
        const match = str5.match(timestamp.test);
        if (!match)
          throw new Error("!!timestamp expects a date, starting with yyyy-mm-dd");
        const [, year, month, day, hour, minute, second] = match.map(Number);
        const millisec = match[7] ? Number((match[7] + "00").substr(1, 3)) : 0;
        let date = Date.UTC(year, month - 1, day, hour || 0, minute || 0, second || 0, millisec);
        const tz = match[8];
        if (tz && tz !== "Z") {
          let d = parseSexagesimal(tz, false);
          if (Math.abs(d) < 30)
            d *= 60;
          date -= 6e4 * d;
        }
        return new Date(date);
      },
      stringify: ({ value }) => value?.toISOString().replace(/(T00:00:00)?\.000Z$/, "") ?? ""
    };
    exports2.floatTime = floatTime;
    exports2.intTime = intTime;
    exports2.timestamp = timestamp;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/schema.js
var require_schema3 = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/schema.js"(exports2) {
    "use strict";
    var map = require_map();
    var _null = require_null();
    var seq = require_seq();
    var string = require_string();
    var binary = require_binary();
    var bool = require_bool2();
    var float = require_float2();
    var int2 = require_int2();
    var merge = require_merge();
    var omap = require_omap();
    var pairs = require_pairs();
    var set = require_set();
    var timestamp = require_timestamp();
    var schema = [
      map.map,
      seq.seq,
      string.string,
      _null.nullTag,
      bool.trueTag,
      bool.falseTag,
      int2.intBin,
      int2.intOct,
      int2.int,
      int2.intHex,
      float.floatNaN,
      float.floatExp,
      float.float,
      binary.binary,
      merge.merge,
      omap.omap,
      pairs.pairs,
      set.set,
      timestamp.intTime,
      timestamp.floatTime,
      timestamp.timestamp
    ];
    exports2.schema = schema;
  }
});

// node_modules/yaml/dist/schema/tags.js
var require_tags = __commonJS({
  "node_modules/yaml/dist/schema/tags.js"(exports2) {
    "use strict";
    var map = require_map();
    var _null = require_null();
    var seq = require_seq();
    var string = require_string();
    var bool = require_bool();
    var float = require_float();
    var int2 = require_int();
    var schema = require_schema();
    var schema$1 = require_schema2();
    var binary = require_binary();
    var merge = require_merge();
    var omap = require_omap();
    var pairs = require_pairs();
    var schema$2 = require_schema3();
    var set = require_set();
    var timestamp = require_timestamp();
    var schemas = /* @__PURE__ */ new Map([
      ["core", schema.schema],
      ["failsafe", [map.map, seq.seq, string.string]],
      ["json", schema$1.schema],
      ["yaml11", schema$2.schema],
      ["yaml-1.1", schema$2.schema]
    ]);
    var tagsByName = {
      binary: binary.binary,
      bool: bool.boolTag,
      float: float.float,
      floatExp: float.floatExp,
      floatNaN: float.floatNaN,
      floatTime: timestamp.floatTime,
      int: int2.int,
      intHex: int2.intHex,
      intOct: int2.intOct,
      intTime: timestamp.intTime,
      map: map.map,
      merge: merge.merge,
      null: _null.nullTag,
      omap: omap.omap,
      pairs: pairs.pairs,
      seq: seq.seq,
      set: set.set,
      timestamp: timestamp.timestamp
    };
    var coreKnownTags = {
      "tag:yaml.org,2002:binary": binary.binary,
      "tag:yaml.org,2002:merge": merge.merge,
      "tag:yaml.org,2002:omap": omap.omap,
      "tag:yaml.org,2002:pairs": pairs.pairs,
      "tag:yaml.org,2002:set": set.set,
      "tag:yaml.org,2002:timestamp": timestamp.timestamp
    };
    function getTags(customTags, schemaName, addMergeTag) {
      const schemaTags = schemas.get(schemaName);
      if (schemaTags && !customTags) {
        return addMergeTag && !schemaTags.includes(merge.merge) ? schemaTags.concat(merge.merge) : schemaTags.slice();
      }
      let tags = schemaTags;
      if (!tags) {
        if (Array.isArray(customTags))
          tags = [];
        else {
          const keys = Array.from(schemas.keys()).filter((key) => key !== "yaml11").map((key) => JSON.stringify(key)).join(", ");
          throw new Error(`Unknown schema "${schemaName}"; use one of ${keys} or define customTags array`);
        }
      }
      if (Array.isArray(customTags)) {
        for (const tag of customTags)
          tags = tags.concat(tag);
      } else if (typeof customTags === "function") {
        tags = customTags(tags.slice());
      }
      if (addMergeTag)
        tags = tags.concat(merge.merge);
      return tags.reduce((tags2, tag) => {
        const tagObj = typeof tag === "string" ? tagsByName[tag] : tag;
        if (!tagObj) {
          const tagName = JSON.stringify(tag);
          const keys = Object.keys(tagsByName).map((key) => JSON.stringify(key)).join(", ");
          throw new Error(`Unknown custom tag ${tagName}; use one of ${keys}`);
        }
        if (!tags2.includes(tagObj))
          tags2.push(tagObj);
        return tags2;
      }, []);
    }
    exports2.coreKnownTags = coreKnownTags;
    exports2.getTags = getTags;
  }
});

// node_modules/yaml/dist/schema/Schema.js
var require_Schema = __commonJS({
  "node_modules/yaml/dist/schema/Schema.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var map = require_map();
    var seq = require_seq();
    var string = require_string();
    var tags = require_tags();
    var sortMapEntriesByKey = (a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    var Schema2 = class _Schema {
      constructor({ compat, customTags, merge, resolveKnownTags, schema, sortMapEntries, toStringDefaults }) {
        this.compat = Array.isArray(compat) ? tags.getTags(compat, "compat") : compat ? tags.getTags(null, compat) : null;
        this.name = typeof schema === "string" && schema || "core";
        this.knownTags = resolveKnownTags ? tags.coreKnownTags : {};
        this.tags = tags.getTags(customTags, this.name, merge);
        this.toStringOptions = toStringDefaults ?? null;
        Object.defineProperty(this, identity.MAP, { value: map.map });
        Object.defineProperty(this, identity.SCALAR, { value: string.string });
        Object.defineProperty(this, identity.SEQ, { value: seq.seq });
        this.sortMapEntries = typeof sortMapEntries === "function" ? sortMapEntries : sortMapEntries === true ? sortMapEntriesByKey : null;
      }
      clone() {
        const copy = Object.create(_Schema.prototype, Object.getOwnPropertyDescriptors(this));
        copy.tags = this.tags.slice();
        return copy;
      }
    };
    exports2.Schema = Schema2;
  }
});

// node_modules/yaml/dist/stringify/stringifyDocument.js
var require_stringifyDocument = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyDocument.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var stringify2 = require_stringify();
    var stringifyComment = require_stringifyComment();
    function stringifyDocument(doc, options) {
      const lines = [];
      let hasDirectives = options.directives === true;
      if (options.directives !== false && doc.directives) {
        const dir = doc.directives.toString(doc);
        if (dir) {
          lines.push(dir);
          hasDirectives = true;
        } else if (doc.directives.docStart)
          hasDirectives = true;
      }
      if (hasDirectives)
        lines.push("---");
      const ctx = stringify2.createStringifyContext(doc, options);
      const { commentString } = ctx.options;
      if (doc.commentBefore) {
        if (lines.length !== 1)
          lines.unshift("");
        const cs = commentString(doc.commentBefore);
        lines.unshift(stringifyComment.indentComment(cs, ""));
      }
      let chompKeep = false;
      let contentComment = null;
      if (doc.contents) {
        if (identity.isNode(doc.contents)) {
          if (doc.contents.spaceBefore && hasDirectives)
            lines.push("");
          if (doc.contents.commentBefore) {
            const cs = commentString(doc.contents.commentBefore);
            lines.push(stringifyComment.indentComment(cs, ""));
          }
          ctx.forceBlockIndent = !!doc.comment;
          contentComment = doc.contents.comment;
        }
        const onChompKeep = contentComment ? void 0 : () => chompKeep = true;
        let body = stringify2.stringify(doc.contents, ctx, () => contentComment = null, onChompKeep);
        if (contentComment)
          body += stringifyComment.lineComment(body, "", commentString(contentComment));
        if ((body[0] === "|" || body[0] === ">") && lines[lines.length - 1] === "---") {
          lines[lines.length - 1] = `--- ${body}`;
        } else
          lines.push(body);
      } else {
        lines.push(stringify2.stringify(doc.contents, ctx));
      }
      if (doc.directives?.docEnd) {
        if (doc.comment) {
          const cs = commentString(doc.comment);
          if (cs.includes("\n")) {
            lines.push("...");
            lines.push(stringifyComment.indentComment(cs, ""));
          } else {
            lines.push(`... ${cs}`);
          }
        } else {
          lines.push("...");
        }
      } else {
        let dc = doc.comment;
        if (dc && chompKeep)
          dc = dc.replace(/^\n+/, "");
        if (dc) {
          if ((!chompKeep || contentComment) && lines[lines.length - 1] !== "")
            lines.push("");
          lines.push(stringifyComment.indentComment(commentString(dc), ""));
        }
      }
      return lines.join("\n") + "\n";
    }
    exports2.stringifyDocument = stringifyDocument;
  }
});

// node_modules/yaml/dist/doc/Document.js
var require_Document = __commonJS({
  "node_modules/yaml/dist/doc/Document.js"(exports2) {
    "use strict";
    var Alias = require_Alias();
    var Collection = require_Collection();
    var identity = require_identity();
    var Pair = require_Pair();
    var toJS = require_toJS();
    var Schema2 = require_Schema();
    var stringifyDocument = require_stringifyDocument();
    var anchors = require_anchors();
    var applyReviver = require_applyReviver();
    var createNode = require_createNode();
    var directives = require_directives();
    var Document = class _Document {
      constructor(value, replacer, options) {
        this.commentBefore = null;
        this.comment = null;
        this.errors = [];
        this.warnings = [];
        Object.defineProperty(this, identity.NODE_TYPE, { value: identity.DOC });
        let _replacer = null;
        if (typeof replacer === "function" || Array.isArray(replacer)) {
          _replacer = replacer;
        } else if (options === void 0 && replacer) {
          options = replacer;
          replacer = void 0;
        }
        const opt = Object.assign({
          intAsBigInt: false,
          keepSourceTokens: false,
          logLevel: "warn",
          prettyErrors: true,
          strict: true,
          stringKeys: false,
          uniqueKeys: true,
          version: "1.2"
        }, options);
        this.options = opt;
        let { version } = opt;
        if (options?._directives) {
          this.directives = options._directives.atDocument();
          if (this.directives.yaml.explicit)
            version = this.directives.yaml.version;
        } else
          this.directives = new directives.Directives({ version });
        this.setSchema(version, options);
        this.contents = value === void 0 ? null : this.createNode(value, _replacer, options);
      }
      /**
       * Create a deep copy of this Document and its contents.
       *
       * Custom Node values that inherit from `Object` still refer to their original instances.
       */
      clone() {
        const copy = Object.create(_Document.prototype, {
          [identity.NODE_TYPE]: { value: identity.DOC }
        });
        copy.commentBefore = this.commentBefore;
        copy.comment = this.comment;
        copy.errors = this.errors.slice();
        copy.warnings = this.warnings.slice();
        copy.options = Object.assign({}, this.options);
        if (this.directives)
          copy.directives = this.directives.clone();
        copy.schema = this.schema.clone();
        copy.contents = identity.isNode(this.contents) ? this.contents.clone(copy.schema) : this.contents;
        if (this.range)
          copy.range = this.range.slice();
        return copy;
      }
      /** Adds a value to the document. */
      add(value) {
        if (assertCollection(this.contents))
          this.contents.add(value);
      }
      /** Adds a value to the document. */
      addIn(path17, value) {
        if (assertCollection(this.contents))
          this.contents.addIn(path17, value);
      }
      /**
       * Create a new `Alias` node, ensuring that the target `node` has the required anchor.
       *
       * If `node` already has an anchor, `name` is ignored.
       * Otherwise, the `node.anchor` value will be set to `name`,
       * or if an anchor with that name is already present in the document,
       * `name` will be used as a prefix for a new unique anchor.
       * If `name` is undefined, the generated anchor will use 'a' as a prefix.
       */
      createAlias(node, name) {
        if (!node.anchor) {
          const prev = anchors.anchorNames(this);
          node.anchor = // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
          !name || prev.has(name) ? anchors.findNewAnchor(name || "a", prev) : name;
        }
        return new Alias.Alias(node.anchor);
      }
      createNode(value, replacer, options) {
        let _replacer = void 0;
        if (typeof replacer === "function") {
          value = replacer.call({ "": value }, "", value);
          _replacer = replacer;
        } else if (Array.isArray(replacer)) {
          const keyToStr = (v) => typeof v === "number" || v instanceof String || v instanceof Number;
          const asStr = replacer.filter(keyToStr).map(String);
          if (asStr.length > 0)
            replacer = replacer.concat(asStr);
          _replacer = replacer;
        } else if (options === void 0 && replacer) {
          options = replacer;
          replacer = void 0;
        }
        const { aliasDuplicateObjects, anchorPrefix, flow, keepUndefined, onTagObj, tag } = options ?? {};
        const { onAnchor, setAnchors, sourceObjects } = anchors.createNodeAnchors(
          this,
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
          anchorPrefix || "a"
        );
        const ctx = {
          aliasDuplicateObjects: aliasDuplicateObjects ?? true,
          keepUndefined: keepUndefined ?? false,
          onAnchor,
          onTagObj,
          replacer: _replacer,
          schema: this.schema,
          sourceObjects
        };
        const node = createNode.createNode(value, tag, ctx);
        if (flow && identity.isCollection(node))
          node.flow = true;
        setAnchors();
        return node;
      }
      /**
       * Convert a key and a value into a `Pair` using the current schema,
       * recursively wrapping all values as `Scalar` or `Collection` nodes.
       */
      createPair(key, value, options = {}) {
        const k = this.createNode(key, null, options);
        const v = this.createNode(value, null, options);
        return new Pair.Pair(k, v);
      }
      /**
       * Removes a value from the document.
       * @returns `true` if the item was found and removed.
       */
      delete(key) {
        return assertCollection(this.contents) ? this.contents.delete(key) : false;
      }
      /**
       * Removes a value from the document.
       * @returns `true` if the item was found and removed.
       */
      deleteIn(path17) {
        if (Collection.isEmptyPath(path17)) {
          if (this.contents == null)
            return false;
          this.contents = null;
          return true;
        }
        return assertCollection(this.contents) ? this.contents.deleteIn(path17) : false;
      }
      /**
       * Returns item at `key`, or `undefined` if not found. By default unwraps
       * scalar values from their surrounding node; to disable set `keepScalar` to
       * `true` (collections are always returned intact).
       */
      get(key, keepScalar) {
        return identity.isCollection(this.contents) ? this.contents.get(key, keepScalar) : void 0;
      }
      /**
       * Returns item at `path`, or `undefined` if not found. By default unwraps
       * scalar values from their surrounding node; to disable set `keepScalar` to
       * `true` (collections are always returned intact).
       */
      getIn(path17, keepScalar) {
        if (Collection.isEmptyPath(path17))
          return !keepScalar && identity.isScalar(this.contents) ? this.contents.value : this.contents;
        return identity.isCollection(this.contents) ? this.contents.getIn(path17, keepScalar) : void 0;
      }
      /**
       * Checks if the document includes a value with the key `key`.
       */
      has(key) {
        return identity.isCollection(this.contents) ? this.contents.has(key) : false;
      }
      /**
       * Checks if the document includes a value at `path`.
       */
      hasIn(path17) {
        if (Collection.isEmptyPath(path17))
          return this.contents !== void 0;
        return identity.isCollection(this.contents) ? this.contents.hasIn(path17) : false;
      }
      /**
       * Sets a value in this document. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      set(key, value) {
        if (this.contents == null) {
          this.contents = Collection.collectionFromPath(this.schema, [key], value);
        } else if (assertCollection(this.contents)) {
          this.contents.set(key, value);
        }
      }
      /**
       * Sets a value in this document. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      setIn(path17, value) {
        if (Collection.isEmptyPath(path17)) {
          this.contents = value;
        } else if (this.contents == null) {
          this.contents = Collection.collectionFromPath(this.schema, Array.from(path17), value);
        } else if (assertCollection(this.contents)) {
          this.contents.setIn(path17, value);
        }
      }
      /**
       * Change the YAML version and schema used by the document.
       * A `null` version disables support for directives, explicit tags, anchors, and aliases.
       * It also requires the `schema` option to be given as a `Schema` instance value.
       *
       * Overrides all previously set schema options.
       */
      setSchema(version, options = {}) {
        if (typeof version === "number")
          version = String(version);
        let opt;
        switch (version) {
          case "1.1":
            if (this.directives)
              this.directives.yaml.version = "1.1";
            else
              this.directives = new directives.Directives({ version: "1.1" });
            opt = { resolveKnownTags: false, schema: "yaml-1.1" };
            break;
          case "1.2":
          case "next":
            if (this.directives)
              this.directives.yaml.version = version;
            else
              this.directives = new directives.Directives({ version });
            opt = { resolveKnownTags: true, schema: "core" };
            break;
          case null:
            if (this.directives)
              delete this.directives;
            opt = null;
            break;
          default: {
            const sv = JSON.stringify(version);
            throw new Error(`Expected '1.1', '1.2' or null as first argument, but found: ${sv}`);
          }
        }
        if (options.schema instanceof Object)
          this.schema = options.schema;
        else if (opt)
          this.schema = new Schema2.Schema(Object.assign(opt, options));
        else
          throw new Error(`With a null YAML version, the { schema: Schema } option is required`);
      }
      // json & jsonArg are only used from toJSON()
      toJS({ json, jsonArg, mapAsMap, maxAliasCount, onAnchor, reviver } = {}) {
        const ctx = {
          anchors: /* @__PURE__ */ new Map(),
          doc: this,
          keep: !json,
          mapAsMap: mapAsMap === true,
          mapKeyWarned: false,
          maxAliasCount: typeof maxAliasCount === "number" ? maxAliasCount : 100
        };
        const res = toJS.toJS(this.contents, jsonArg ?? "", ctx);
        if (typeof onAnchor === "function")
          for (const { count: count2, res: res2 } of ctx.anchors.values())
            onAnchor(res2, count2);
        return typeof reviver === "function" ? applyReviver.applyReviver(reviver, { "": res }, "", res) : res;
      }
      /**
       * A JSON representation of the document `contents`.
       *
       * @param jsonArg Used by `JSON.stringify` to indicate the array index or
       *   property name.
       */
      toJSON(jsonArg, onAnchor) {
        return this.toJS({ json: true, jsonArg, mapAsMap: false, onAnchor });
      }
      /** A YAML representation of the document. */
      toString(options = {}) {
        if (this.errors.length > 0)
          throw new Error("Document with errors cannot be stringified");
        if ("indent" in options && (!Number.isInteger(options.indent) || Number(options.indent) <= 0)) {
          const s2 = JSON.stringify(options.indent);
          throw new Error(`"indent" option must be a positive integer, not ${s2}`);
        }
        return stringifyDocument.stringifyDocument(this, options);
      }
    };
    function assertCollection(contents) {
      if (identity.isCollection(contents))
        return true;
      throw new Error("Expected a YAML collection as document contents");
    }
    exports2.Document = Document;
  }
});

// node_modules/yaml/dist/errors.js
var require_errors = __commonJS({
  "node_modules/yaml/dist/errors.js"(exports2) {
    "use strict";
    var YAMLError = class extends Error {
      constructor(name, pos, code, message) {
        super();
        this.name = name;
        this.code = code;
        this.message = message;
        this.pos = pos;
      }
    };
    var YAMLParseError = class extends YAMLError {
      constructor(pos, code, message) {
        super("YAMLParseError", pos, code, message);
      }
    };
    var YAMLWarning = class extends YAMLError {
      constructor(pos, code, message) {
        super("YAMLWarning", pos, code, message);
      }
    };
    var prettifyError = (src, lc) => (error) => {
      if (error.pos[0] === -1)
        return;
      error.linePos = error.pos.map((pos) => lc.linePos(pos));
      const { line, col } = error.linePos[0];
      error.message += ` at line ${line}, column ${col}`;
      let ci = col - 1;
      let lineStr = src.substring(lc.lineStarts[line - 1], lc.lineStarts[line]).replace(/[\n\r]+$/, "");
      if (ci >= 60 && lineStr.length > 80) {
        const trimStart = Math.min(ci - 39, lineStr.length - 79);
        lineStr = "\u2026" + lineStr.substring(trimStart);
        ci -= trimStart - 1;
      }
      if (lineStr.length > 80)
        lineStr = lineStr.substring(0, 79) + "\u2026";
      if (line > 1 && /^ *$/.test(lineStr.substring(0, ci))) {
        let prev = src.substring(lc.lineStarts[line - 2], lc.lineStarts[line - 1]);
        if (prev.length > 80)
          prev = prev.substring(0, 79) + "\u2026\n";
        lineStr = prev + lineStr;
      }
      if (/[^ ]/.test(lineStr)) {
        let count2 = 1;
        const end = error.linePos[1];
        if (end?.line === line && end.col > col) {
          count2 = Math.max(1, Math.min(end.col - col, 80 - ci));
        }
        const pointer = " ".repeat(ci) + "^".repeat(count2);
        error.message += `:

${lineStr}
${pointer}
`;
      }
    };
    exports2.YAMLError = YAMLError;
    exports2.YAMLParseError = YAMLParseError;
    exports2.YAMLWarning = YAMLWarning;
    exports2.prettifyError = prettifyError;
  }
});

// node_modules/yaml/dist/compose/resolve-props.js
var require_resolve_props = __commonJS({
  "node_modules/yaml/dist/compose/resolve-props.js"(exports2) {
    "use strict";
    function resolveProps(tokens, { flow, indicator, next, offset, onError, parentIndent, startOnNewline }) {
      let spaceBefore = false;
      let atNewline = startOnNewline;
      let hasSpace = startOnNewline;
      let comment = "";
      let commentSep = "";
      let hasNewline = false;
      let reqSpace = false;
      let tab = null;
      let anchor = null;
      let tag = null;
      let newlineAfterProp = null;
      let comma = null;
      let found = null;
      let start = null;
      for (const token of tokens) {
        if (reqSpace) {
          if (token.type !== "space" && token.type !== "newline" && token.type !== "comma")
            onError(token.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space");
          reqSpace = false;
        }
        if (tab) {
          if (atNewline && token.type !== "comment" && token.type !== "newline") {
            onError(tab, "TAB_AS_INDENT", "Tabs are not allowed as indentation");
          }
          tab = null;
        }
        switch (token.type) {
          case "space":
            if (!flow && (indicator !== "doc-start" || next?.type !== "flow-collection") && token.source.includes("	")) {
              tab = token;
            }
            hasSpace = true;
            break;
          case "comment": {
            if (!hasSpace)
              onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
            const cb = token.source.substring(1) || " ";
            if (!comment)
              comment = cb;
            else
              comment += commentSep + cb;
            commentSep = "";
            atNewline = false;
            break;
          }
          case "newline":
            if (atNewline) {
              if (comment)
                comment += token.source;
              else if (!found || indicator !== "seq-item-ind")
                spaceBefore = true;
            } else
              commentSep += token.source;
            atNewline = true;
            hasNewline = true;
            if (anchor || tag)
              newlineAfterProp = token;
            hasSpace = true;
            break;
          case "anchor":
            if (anchor)
              onError(token, "MULTIPLE_ANCHORS", "A node can have at most one anchor");
            if (token.source.endsWith(":"))
              onError(token.offset + token.source.length - 1, "BAD_ALIAS", "Anchor ending in : is ambiguous", true);
            anchor = token;
            start ?? (start = token.offset);
            atNewline = false;
            hasSpace = false;
            reqSpace = true;
            break;
          case "tag": {
            if (tag)
              onError(token, "MULTIPLE_TAGS", "A node can have at most one tag");
            tag = token;
            start ?? (start = token.offset);
            atNewline = false;
            hasSpace = false;
            reqSpace = true;
            break;
          }
          case indicator:
            if (anchor || tag)
              onError(token, "BAD_PROP_ORDER", `Anchors and tags must be after the ${token.source} indicator`);
            if (found)
              onError(token, "UNEXPECTED_TOKEN", `Unexpected ${token.source} in ${flow ?? "collection"}`);
            found = token;
            atNewline = indicator === "seq-item-ind" || indicator === "explicit-key-ind";
            hasSpace = false;
            break;
          case "comma":
            if (flow) {
              if (comma)
                onError(token, "UNEXPECTED_TOKEN", `Unexpected , in ${flow}`);
              comma = token;
              atNewline = false;
              hasSpace = false;
              break;
            }
          // else fallthrough
          default:
            onError(token, "UNEXPECTED_TOKEN", `Unexpected ${token.type} token`);
            atNewline = false;
            hasSpace = false;
        }
      }
      const last = tokens[tokens.length - 1];
      const end = last ? last.offset + last.source.length : offset;
      if (reqSpace && next && next.type !== "space" && next.type !== "newline" && next.type !== "comma" && (next.type !== "scalar" || next.source !== "")) {
        onError(next.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space");
      }
      if (tab && (atNewline && tab.indent <= parentIndent || next?.type === "block-map" || next?.type === "block-seq"))
        onError(tab, "TAB_AS_INDENT", "Tabs are not allowed as indentation");
      return {
        comma,
        found,
        spaceBefore,
        comment,
        hasNewline,
        anchor,
        tag,
        newlineAfterProp,
        end,
        start: start ?? end
      };
    }
    exports2.resolveProps = resolveProps;
  }
});

// node_modules/yaml/dist/compose/util-contains-newline.js
var require_util_contains_newline = __commonJS({
  "node_modules/yaml/dist/compose/util-contains-newline.js"(exports2) {
    "use strict";
    function containsNewline(key) {
      if (!key)
        return null;
      switch (key.type) {
        case "alias":
        case "scalar":
        case "double-quoted-scalar":
        case "single-quoted-scalar":
          if (key.source.includes("\n"))
            return true;
          if (key.end) {
            for (const st of key.end)
              if (st.type === "newline")
                return true;
          }
          return false;
        case "flow-collection":
          for (const it of key.items) {
            for (const st of it.start)
              if (st.type === "newline")
                return true;
            if (it.sep) {
              for (const st of it.sep)
                if (st.type === "newline")
                  return true;
            }
            if (containsNewline(it.key) || containsNewline(it.value))
              return true;
          }
          return false;
        default:
          return true;
      }
    }
    exports2.containsNewline = containsNewline;
  }
});

// node_modules/yaml/dist/compose/util-flow-indent-check.js
var require_util_flow_indent_check = __commonJS({
  "node_modules/yaml/dist/compose/util-flow-indent-check.js"(exports2) {
    "use strict";
    var utilContainsNewline = require_util_contains_newline();
    function flowIndentCheck(indent, fc, onError) {
      if (fc?.type === "flow-collection") {
        const end = fc.end[0];
        if (end.indent === indent && (end.source === "]" || end.source === "}") && utilContainsNewline.containsNewline(fc)) {
          const msg = "Flow end indicator should be more indented than parent";
          onError(end, "BAD_INDENT", msg, true);
        }
      }
    }
    exports2.flowIndentCheck = flowIndentCheck;
  }
});

// node_modules/yaml/dist/compose/util-map-includes.js
var require_util_map_includes = __commonJS({
  "node_modules/yaml/dist/compose/util-map-includes.js"(exports2) {
    "use strict";
    var identity = require_identity();
    function mapIncludes(ctx, items, search) {
      const { uniqueKeys } = ctx.options;
      if (uniqueKeys === false)
        return false;
      const isEqual = typeof uniqueKeys === "function" ? uniqueKeys : (a, b) => a === b || identity.isScalar(a) && identity.isScalar(b) && a.value === b.value;
      return items.some((pair) => isEqual(pair.key, search));
    }
    exports2.mapIncludes = mapIncludes;
  }
});

// node_modules/yaml/dist/compose/resolve-block-map.js
var require_resolve_block_map = __commonJS({
  "node_modules/yaml/dist/compose/resolve-block-map.js"(exports2) {
    "use strict";
    var Pair = require_Pair();
    var YAMLMap = require_YAMLMap();
    var resolveProps = require_resolve_props();
    var utilContainsNewline = require_util_contains_newline();
    var utilFlowIndentCheck = require_util_flow_indent_check();
    var utilMapIncludes = require_util_map_includes();
    var startColMsg = "All mapping items must start at the same column";
    function resolveBlockMap({ composeNode, composeEmptyNode }, ctx, bm, onError, tag) {
      const NodeClass = tag?.nodeClass ?? YAMLMap.YAMLMap;
      const map = new NodeClass(ctx.schema);
      if (ctx.atRoot)
        ctx.atRoot = false;
      let offset = bm.offset;
      let commentEnd = null;
      for (const collItem of bm.items) {
        const { start, key, sep, value } = collItem;
        const keyProps = resolveProps.resolveProps(start, {
          indicator: "explicit-key-ind",
          next: key ?? sep?.[0],
          offset,
          onError,
          parentIndent: bm.indent,
          startOnNewline: true
        });
        const implicitKey = !keyProps.found;
        if (implicitKey) {
          if (key) {
            if (key.type === "block-seq")
              onError(offset, "BLOCK_AS_IMPLICIT_KEY", "A block sequence may not be used as an implicit map key");
            else if ("indent" in key && key.indent !== bm.indent)
              onError(offset, "BAD_INDENT", startColMsg);
          }
          if (!keyProps.anchor && !keyProps.tag && !sep) {
            commentEnd = keyProps.end;
            if (keyProps.comment) {
              if (map.comment)
                map.comment += "\n" + keyProps.comment;
              else
                map.comment = keyProps.comment;
            }
            continue;
          }
          if (keyProps.newlineAfterProp || utilContainsNewline.containsNewline(key)) {
            onError(key ?? start[start.length - 1], "MULTILINE_IMPLICIT_KEY", "Implicit keys need to be on a single line");
          }
        } else if (keyProps.found?.indent !== bm.indent) {
          onError(offset, "BAD_INDENT", startColMsg);
        }
        ctx.atKey = true;
        const keyStart = keyProps.end;
        const keyNode = key ? composeNode(ctx, key, keyProps, onError) : composeEmptyNode(ctx, keyStart, start, null, keyProps, onError);
        if (ctx.schema.compat)
          utilFlowIndentCheck.flowIndentCheck(bm.indent, key, onError);
        ctx.atKey = false;
        if (utilMapIncludes.mapIncludes(ctx, map.items, keyNode))
          onError(keyStart, "DUPLICATE_KEY", "Map keys must be unique");
        const valueProps = resolveProps.resolveProps(sep ?? [], {
          indicator: "map-value-ind",
          next: value,
          offset: keyNode.range[2],
          onError,
          parentIndent: bm.indent,
          startOnNewline: !key || key.type === "block-scalar"
        });
        offset = valueProps.end;
        if (valueProps.found) {
          if (implicitKey) {
            if (value?.type === "block-map" && !valueProps.hasNewline)
              onError(offset, "BLOCK_AS_IMPLICIT_KEY", "Nested mappings are not allowed in compact mappings");
            if (ctx.options.strict && keyProps.start < valueProps.found.offset - 1024)
              onError(keyNode.range, "KEY_OVER_1024_CHARS", "The : indicator must be at most 1024 chars after the start of an implicit block mapping key");
          }
          const valueNode = value ? composeNode(ctx, value, valueProps, onError) : composeEmptyNode(ctx, offset, sep, null, valueProps, onError);
          if (ctx.schema.compat)
            utilFlowIndentCheck.flowIndentCheck(bm.indent, value, onError);
          offset = valueNode.range[2];
          const pair = new Pair.Pair(keyNode, valueNode);
          if (ctx.options.keepSourceTokens)
            pair.srcToken = collItem;
          map.items.push(pair);
        } else {
          if (implicitKey)
            onError(keyNode.range, "MISSING_CHAR", "Implicit map keys need to be followed by map values");
          if (valueProps.comment) {
            if (keyNode.comment)
              keyNode.comment += "\n" + valueProps.comment;
            else
              keyNode.comment = valueProps.comment;
          }
          const pair = new Pair.Pair(keyNode);
          if (ctx.options.keepSourceTokens)
            pair.srcToken = collItem;
          map.items.push(pair);
        }
      }
      if (commentEnd && commentEnd < offset)
        onError(commentEnd, "IMPOSSIBLE", "Map comment with trailing content");
      map.range = [bm.offset, offset, commentEnd ?? offset];
      return map;
    }
    exports2.resolveBlockMap = resolveBlockMap;
  }
});

// node_modules/yaml/dist/compose/resolve-block-seq.js
var require_resolve_block_seq = __commonJS({
  "node_modules/yaml/dist/compose/resolve-block-seq.js"(exports2) {
    "use strict";
    var YAMLSeq = require_YAMLSeq();
    var resolveProps = require_resolve_props();
    var utilFlowIndentCheck = require_util_flow_indent_check();
    function resolveBlockSeq({ composeNode, composeEmptyNode }, ctx, bs, onError, tag) {
      const NodeClass = tag?.nodeClass ?? YAMLSeq.YAMLSeq;
      const seq = new NodeClass(ctx.schema);
      if (ctx.atRoot)
        ctx.atRoot = false;
      if (ctx.atKey)
        ctx.atKey = false;
      let offset = bs.offset;
      let commentEnd = null;
      for (const { start, value } of bs.items) {
        const props = resolveProps.resolveProps(start, {
          indicator: "seq-item-ind",
          next: value,
          offset,
          onError,
          parentIndent: bs.indent,
          startOnNewline: true
        });
        if (!props.found) {
          if (props.anchor || props.tag || value) {
            if (value?.type === "block-seq")
              onError(props.end, "BAD_INDENT", "All sequence items must start at the same column");
            else
              onError(offset, "MISSING_CHAR", "Sequence item without - indicator");
          } else {
            commentEnd = props.end;
            if (props.comment)
              seq.comment = props.comment;
            continue;
          }
        }
        const node = value ? composeNode(ctx, value, props, onError) : composeEmptyNode(ctx, props.end, start, null, props, onError);
        if (ctx.schema.compat)
          utilFlowIndentCheck.flowIndentCheck(bs.indent, value, onError);
        offset = node.range[2];
        seq.items.push(node);
      }
      seq.range = [bs.offset, offset, commentEnd ?? offset];
      return seq;
    }
    exports2.resolveBlockSeq = resolveBlockSeq;
  }
});

// node_modules/yaml/dist/compose/resolve-end.js
var require_resolve_end = __commonJS({
  "node_modules/yaml/dist/compose/resolve-end.js"(exports2) {
    "use strict";
    function resolveEnd(end, offset, reqSpace, onError) {
      let comment = "";
      if (end) {
        let hasSpace = false;
        let sep = "";
        for (const token of end) {
          const { source, type } = token;
          switch (type) {
            case "space":
              hasSpace = true;
              break;
            case "comment": {
              if (reqSpace && !hasSpace)
                onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
              const cb = source.substring(1) || " ";
              if (!comment)
                comment = cb;
              else
                comment += sep + cb;
              sep = "";
              break;
            }
            case "newline":
              if (comment)
                sep += source;
              hasSpace = true;
              break;
            default:
              onError(token, "UNEXPECTED_TOKEN", `Unexpected ${type} at node end`);
          }
          offset += source.length;
        }
      }
      return { comment, offset };
    }
    exports2.resolveEnd = resolveEnd;
  }
});

// node_modules/yaml/dist/compose/resolve-flow-collection.js
var require_resolve_flow_collection = __commonJS({
  "node_modules/yaml/dist/compose/resolve-flow-collection.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var Pair = require_Pair();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var resolveEnd = require_resolve_end();
    var resolveProps = require_resolve_props();
    var utilContainsNewline = require_util_contains_newline();
    var utilMapIncludes = require_util_map_includes();
    var blockMsg = "Block collections are not allowed within flow collections";
    var isBlock = (token) => token && (token.type === "block-map" || token.type === "block-seq");
    function resolveFlowCollection({ composeNode, composeEmptyNode }, ctx, fc, onError, tag) {
      const isMap = fc.start.source === "{";
      const fcName = isMap ? "flow map" : "flow sequence";
      const NodeClass = tag?.nodeClass ?? (isMap ? YAMLMap.YAMLMap : YAMLSeq.YAMLSeq);
      const coll = new NodeClass(ctx.schema);
      coll.flow = true;
      const atRoot = ctx.atRoot;
      if (atRoot)
        ctx.atRoot = false;
      if (ctx.atKey)
        ctx.atKey = false;
      let offset = fc.offset + fc.start.source.length;
      for (let i = 0; i < fc.items.length; ++i) {
        const collItem = fc.items[i];
        const { start, key, sep, value } = collItem;
        const props = resolveProps.resolveProps(start, {
          flow: fcName,
          indicator: "explicit-key-ind",
          next: key ?? sep?.[0],
          offset,
          onError,
          parentIndent: fc.indent,
          startOnNewline: false
        });
        if (!props.found) {
          if (!props.anchor && !props.tag && !sep && !value) {
            if (i === 0 && props.comma)
              onError(props.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${fcName}`);
            else if (i < fc.items.length - 1)
              onError(props.start, "UNEXPECTED_TOKEN", `Unexpected empty item in ${fcName}`);
            if (props.comment) {
              if (coll.comment)
                coll.comment += "\n" + props.comment;
              else
                coll.comment = props.comment;
            }
            offset = props.end;
            continue;
          }
          if (!isMap && ctx.options.strict && utilContainsNewline.containsNewline(key))
            onError(
              key,
              // checked by containsNewline()
              "MULTILINE_IMPLICIT_KEY",
              "Implicit keys of flow sequence pairs need to be on a single line"
            );
        }
        if (i === 0) {
          if (props.comma)
            onError(props.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${fcName}`);
        } else {
          if (!props.comma)
            onError(props.start, "MISSING_CHAR", `Missing , between ${fcName} items`);
          if (props.comment) {
            let prevItemComment = "";
            loop: for (const st of start) {
              switch (st.type) {
                case "comma":
                case "space":
                  break;
                case "comment":
                  prevItemComment = st.source.substring(1);
                  break loop;
                default:
                  break loop;
              }
            }
            if (prevItemComment) {
              let prev = coll.items[coll.items.length - 1];
              if (identity.isPair(prev))
                prev = prev.value ?? prev.key;
              if (prev.comment)
                prev.comment += "\n" + prevItemComment;
              else
                prev.comment = prevItemComment;
              props.comment = props.comment.substring(prevItemComment.length + 1);
            }
          }
        }
        if (!isMap && !sep && !props.found) {
          const valueNode = value ? composeNode(ctx, value, props, onError) : composeEmptyNode(ctx, props.end, sep, null, props, onError);
          coll.items.push(valueNode);
          offset = valueNode.range[2];
          if (isBlock(value))
            onError(valueNode.range, "BLOCK_IN_FLOW", blockMsg);
        } else {
          ctx.atKey = true;
          const keyStart = props.end;
          const keyNode = key ? composeNode(ctx, key, props, onError) : composeEmptyNode(ctx, keyStart, start, null, props, onError);
          if (isBlock(key))
            onError(keyNode.range, "BLOCK_IN_FLOW", blockMsg);
          ctx.atKey = false;
          const valueProps = resolveProps.resolveProps(sep ?? [], {
            flow: fcName,
            indicator: "map-value-ind",
            next: value,
            offset: keyNode.range[2],
            onError,
            parentIndent: fc.indent,
            startOnNewline: false
          });
          if (valueProps.found) {
            if (!isMap && !props.found && ctx.options.strict) {
              if (sep)
                for (const st of sep) {
                  if (st === valueProps.found)
                    break;
                  if (st.type === "newline") {
                    onError(st, "MULTILINE_IMPLICIT_KEY", "Implicit keys of flow sequence pairs need to be on a single line");
                    break;
                  }
                }
              if (props.start < valueProps.found.offset - 1024)
                onError(valueProps.found, "KEY_OVER_1024_CHARS", "The : indicator must be at most 1024 chars after the start of an implicit flow sequence key");
            }
          } else if (value) {
            if ("source" in value && value.source?.[0] === ":")
              onError(value, "MISSING_CHAR", `Missing space after : in ${fcName}`);
            else
              onError(valueProps.start, "MISSING_CHAR", `Missing , or : between ${fcName} items`);
          }
          const valueNode = value ? composeNode(ctx, value, valueProps, onError) : valueProps.found ? composeEmptyNode(ctx, valueProps.end, sep, null, valueProps, onError) : null;
          if (valueNode) {
            if (isBlock(value))
              onError(valueNode.range, "BLOCK_IN_FLOW", blockMsg);
          } else if (valueProps.comment) {
            if (keyNode.comment)
              keyNode.comment += "\n" + valueProps.comment;
            else
              keyNode.comment = valueProps.comment;
          }
          const pair = new Pair.Pair(keyNode, valueNode);
          if (ctx.options.keepSourceTokens)
            pair.srcToken = collItem;
          if (isMap) {
            const map = coll;
            if (utilMapIncludes.mapIncludes(ctx, map.items, keyNode))
              onError(keyStart, "DUPLICATE_KEY", "Map keys must be unique");
            map.items.push(pair);
          } else {
            const map = new YAMLMap.YAMLMap(ctx.schema);
            map.flow = true;
            map.items.push(pair);
            const endRange = (valueNode ?? keyNode).range;
            map.range = [keyNode.range[0], endRange[1], endRange[2]];
            coll.items.push(map);
          }
          offset = valueNode ? valueNode.range[2] : valueProps.end;
        }
      }
      const expectedEnd = isMap ? "}" : "]";
      const [ce, ...ee] = fc.end;
      let cePos = offset;
      if (ce?.source === expectedEnd)
        cePos = ce.offset + ce.source.length;
      else {
        const name = fcName[0].toUpperCase() + fcName.substring(1);
        const msg = atRoot ? `${name} must end with a ${expectedEnd}` : `${name} in block collection must be sufficiently indented and end with a ${expectedEnd}`;
        onError(offset, atRoot ? "MISSING_CHAR" : "BAD_INDENT", msg);
        if (ce && ce.source.length !== 1)
          ee.unshift(ce);
      }
      if (ee.length > 0) {
        const end = resolveEnd.resolveEnd(ee, cePos, ctx.options.strict, onError);
        if (end.comment) {
          if (coll.comment)
            coll.comment += "\n" + end.comment;
          else
            coll.comment = end.comment;
        }
        coll.range = [fc.offset, cePos, end.offset];
      } else {
        coll.range = [fc.offset, cePos, cePos];
      }
      return coll;
    }
    exports2.resolveFlowCollection = resolveFlowCollection;
  }
});

// node_modules/yaml/dist/compose/compose-collection.js
var require_compose_collection = __commonJS({
  "node_modules/yaml/dist/compose/compose-collection.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var resolveBlockMap = require_resolve_block_map();
    var resolveBlockSeq = require_resolve_block_seq();
    var resolveFlowCollection = require_resolve_flow_collection();
    function resolveCollection(CN, ctx, token, onError, tagName, tag) {
      const coll = token.type === "block-map" ? resolveBlockMap.resolveBlockMap(CN, ctx, token, onError, tag) : token.type === "block-seq" ? resolveBlockSeq.resolveBlockSeq(CN, ctx, token, onError, tag) : resolveFlowCollection.resolveFlowCollection(CN, ctx, token, onError, tag);
      const Coll = coll.constructor;
      if (tagName === "!" || tagName === Coll.tagName) {
        coll.tag = Coll.tagName;
        return coll;
      }
      if (tagName)
        coll.tag = tagName;
      return coll;
    }
    function composeCollection(CN, ctx, token, props, onError) {
      const tagToken = props.tag;
      const tagName = !tagToken ? null : ctx.directives.tagName(tagToken.source, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg));
      if (token.type === "block-seq") {
        const { anchor, newlineAfterProp: nl } = props;
        const lastProp = anchor && tagToken ? anchor.offset > tagToken.offset ? anchor : tagToken : anchor ?? tagToken;
        if (lastProp && (!nl || nl.offset < lastProp.offset)) {
          const message = "Missing newline after block sequence props";
          onError(lastProp, "MISSING_CHAR", message);
        }
      }
      const expType = token.type === "block-map" ? "map" : token.type === "block-seq" ? "seq" : token.start.source === "{" ? "map" : "seq";
      if (!tagToken || !tagName || tagName === "!" || tagName === YAMLMap.YAMLMap.tagName && expType === "map" || tagName === YAMLSeq.YAMLSeq.tagName && expType === "seq") {
        return resolveCollection(CN, ctx, token, onError, tagName);
      }
      let tag = ctx.schema.tags.find((t) => t.tag === tagName && t.collection === expType);
      if (!tag) {
        const kt = ctx.schema.knownTags[tagName];
        if (kt?.collection === expType) {
          ctx.schema.tags.push(Object.assign({}, kt, { default: false }));
          tag = kt;
        } else {
          if (kt) {
            onError(tagToken, "BAD_COLLECTION_TYPE", `${kt.tag} used for ${expType} collection, but expects ${kt.collection ?? "scalar"}`, true);
          } else {
            onError(tagToken, "TAG_RESOLVE_FAILED", `Unresolved tag: ${tagName}`, true);
          }
          return resolveCollection(CN, ctx, token, onError, tagName);
        }
      }
      const coll = resolveCollection(CN, ctx, token, onError, tagName, tag);
      const res = tag.resolve?.(coll, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg), ctx.options) ?? coll;
      const node = identity.isNode(res) ? res : new Scalar.Scalar(res);
      node.range = coll.range;
      node.tag = tagName;
      if (tag?.format)
        node.format = tag.format;
      return node;
    }
    exports2.composeCollection = composeCollection;
  }
});

// node_modules/yaml/dist/compose/resolve-block-scalar.js
var require_resolve_block_scalar = __commonJS({
  "node_modules/yaml/dist/compose/resolve-block-scalar.js"(exports2) {
    "use strict";
    var Scalar = require_Scalar();
    function resolveBlockScalar(ctx, scalar, onError) {
      const start = scalar.offset;
      const header = parseBlockScalarHeader(scalar, ctx.options.strict, onError);
      if (!header)
        return { value: "", type: null, comment: "", range: [start, start, start] };
      const type = header.mode === ">" ? Scalar.Scalar.BLOCK_FOLDED : Scalar.Scalar.BLOCK_LITERAL;
      const lines = scalar.source ? splitLines(scalar.source) : [];
      let chompStart = lines.length;
      for (let i = lines.length - 1; i >= 0; --i) {
        const content = lines[i][1];
        if (content === "" || content === "\r")
          chompStart = i;
        else
          break;
      }
      if (chompStart === 0) {
        const value2 = header.chomp === "+" && lines.length > 0 ? "\n".repeat(Math.max(1, lines.length - 1)) : "";
        let end2 = start + header.length;
        if (scalar.source)
          end2 += scalar.source.length;
        return { value: value2, type, comment: header.comment, range: [start, end2, end2] };
      }
      let trimIndent = scalar.indent + header.indent;
      let offset = scalar.offset + header.length;
      let contentStart = 0;
      for (let i = 0; i < chompStart; ++i) {
        const [indent, content] = lines[i];
        if (content === "" || content === "\r") {
          if (header.indent === 0 && indent.length > trimIndent)
            trimIndent = indent.length;
        } else {
          if (indent.length < trimIndent) {
            const message = "Block scalars with more-indented leading empty lines must use an explicit indentation indicator";
            onError(offset + indent.length, "MISSING_CHAR", message);
          }
          if (header.indent === 0)
            trimIndent = indent.length;
          contentStart = i;
          if (trimIndent === 0 && !ctx.atRoot) {
            const message = "Block scalar values in collections must be indented";
            onError(offset, "BAD_INDENT", message);
          }
          break;
        }
        offset += indent.length + content.length + 1;
      }
      for (let i = lines.length - 1; i >= chompStart; --i) {
        if (lines[i][0].length > trimIndent)
          chompStart = i + 1;
      }
      let value = "";
      let sep = "";
      let prevMoreIndented = false;
      for (let i = 0; i < contentStart; ++i)
        value += lines[i][0].slice(trimIndent) + "\n";
      for (let i = contentStart; i < chompStart; ++i) {
        let [indent, content] = lines[i];
        offset += indent.length + content.length + 1;
        const crlf = content[content.length - 1] === "\r";
        if (crlf)
          content = content.slice(0, -1);
        if (content && indent.length < trimIndent) {
          const src = header.indent ? "explicit indentation indicator" : "first line";
          const message = `Block scalar lines must not be less indented than their ${src}`;
          onError(offset - content.length - (crlf ? 2 : 1), "BAD_INDENT", message);
          indent = "";
        }
        if (type === Scalar.Scalar.BLOCK_LITERAL) {
          value += sep + indent.slice(trimIndent) + content;
          sep = "\n";
        } else if (indent.length > trimIndent || content[0] === "	") {
          if (sep === " ")
            sep = "\n";
          else if (!prevMoreIndented && sep === "\n")
            sep = "\n\n";
          value += sep + indent.slice(trimIndent) + content;
          sep = "\n";
          prevMoreIndented = true;
        } else if (content === "") {
          if (sep === "\n")
            value += "\n";
          else
            sep = "\n";
        } else {
          value += sep + content;
          sep = " ";
          prevMoreIndented = false;
        }
      }
      switch (header.chomp) {
        case "-":
          break;
        case "+":
          for (let i = chompStart; i < lines.length; ++i)
            value += "\n" + lines[i][0].slice(trimIndent);
          if (value[value.length - 1] !== "\n")
            value += "\n";
          break;
        default:
          value += "\n";
      }
      const end = start + header.length + scalar.source.length;
      return { value, type, comment: header.comment, range: [start, end, end] };
    }
    function parseBlockScalarHeader({ offset, props }, strict, onError) {
      if (props[0].type !== "block-scalar-header") {
        onError(props[0], "IMPOSSIBLE", "Block scalar header not found");
        return null;
      }
      const { source } = props[0];
      const mode = source[0];
      let indent = 0;
      let chomp = "";
      let error = -1;
      for (let i = 1; i < source.length; ++i) {
        const ch = source[i];
        if (!chomp && (ch === "-" || ch === "+"))
          chomp = ch;
        else {
          const n = Number(ch);
          if (!indent && n)
            indent = n;
          else if (error === -1)
            error = offset + i;
        }
      }
      if (error !== -1)
        onError(error, "UNEXPECTED_TOKEN", `Block scalar header includes extra characters: ${source}`);
      let hasSpace = false;
      let comment = "";
      let length = source.length;
      for (let i = 1; i < props.length; ++i) {
        const token = props[i];
        switch (token.type) {
          case "space":
            hasSpace = true;
          // fallthrough
          case "newline":
            length += token.source.length;
            break;
          case "comment":
            if (strict && !hasSpace) {
              const message = "Comments must be separated from other tokens by white space characters";
              onError(token, "MISSING_CHAR", message);
            }
            length += token.source.length;
            comment = token.source.substring(1);
            break;
          case "error":
            onError(token, "UNEXPECTED_TOKEN", token.message);
            length += token.source.length;
            break;
          /* istanbul ignore next should not happen */
          default: {
            const message = `Unexpected token in block scalar header: ${token.type}`;
            onError(token, "UNEXPECTED_TOKEN", message);
            const ts = token.source;
            if (ts && typeof ts === "string")
              length += ts.length;
          }
        }
      }
      return { mode, indent, chomp, comment, length };
    }
    function splitLines(source) {
      const split = source.split(/\n( *)/);
      const first = split[0];
      const m = first.match(/^( *)/);
      const line0 = m?.[1] ? [m[1], first.slice(m[1].length)] : ["", first];
      const lines = [line0];
      for (let i = 1; i < split.length; i += 2)
        lines.push([split[i], split[i + 1]]);
      return lines;
    }
    exports2.resolveBlockScalar = resolveBlockScalar;
  }
});

// node_modules/yaml/dist/compose/resolve-flow-scalar.js
var require_resolve_flow_scalar = __commonJS({
  "node_modules/yaml/dist/compose/resolve-flow-scalar.js"(exports2) {
    "use strict";
    var Scalar = require_Scalar();
    var resolveEnd = require_resolve_end();
    function resolveFlowScalar(scalar, strict, onError) {
      const { offset, type, source, end } = scalar;
      let _type;
      let value;
      const _onError = (rel, code, msg) => onError(offset + rel, code, msg);
      switch (type) {
        case "scalar":
          _type = Scalar.Scalar.PLAIN;
          value = plainValue(source, _onError);
          break;
        case "single-quoted-scalar":
          _type = Scalar.Scalar.QUOTE_SINGLE;
          value = singleQuotedValue(source, _onError);
          break;
        case "double-quoted-scalar":
          _type = Scalar.Scalar.QUOTE_DOUBLE;
          value = doubleQuotedValue(source, _onError);
          break;
        /* istanbul ignore next should not happen */
        default:
          onError(scalar, "UNEXPECTED_TOKEN", `Expected a flow scalar value, but found: ${type}`);
          return {
            value: "",
            type: null,
            comment: "",
            range: [offset, offset + source.length, offset + source.length]
          };
      }
      const valueEnd = offset + source.length;
      const re = resolveEnd.resolveEnd(end, valueEnd, strict, onError);
      return {
        value,
        type: _type,
        comment: re.comment,
        range: [offset, valueEnd, re.offset]
      };
    }
    function plainValue(source, onError) {
      let badChar = "";
      switch (source[0]) {
        /* istanbul ignore next should not happen */
        case "	":
          badChar = "a tab character";
          break;
        case ",":
          badChar = "flow indicator character ,";
          break;
        case "%":
          badChar = "directive indicator character %";
          break;
        case "|":
        case ">": {
          badChar = `block scalar indicator ${source[0]}`;
          break;
        }
        case "@":
        case "`": {
          badChar = `reserved character ${source[0]}`;
          break;
        }
      }
      if (badChar)
        onError(0, "BAD_SCALAR_START", `Plain value cannot start with ${badChar}`);
      return unfoldLines(source);
    }
    function singleQuotedValue(source, onError) {
      if (source[source.length - 1] !== "'" || source.length === 1)
        onError(source.length, "MISSING_CHAR", "Missing closing 'quote");
      return unfoldLines(source.slice(1, -1)).replace(/''/g, "'");
    }
    function unfoldLines(source) {
      const line = /(.*?)\r?\n/sy;
      let match = line.exec(source);
      if (!match)
        return source;
      let trimEnd, trimBoth;
      try {
        trimEnd = new RegExp("(?<![ 	])[ 	]+$");
        trimBoth = new RegExp("^[ 	]+|(?<![ 	])[ 	]+$", "g");
      } catch {
        trimEnd = /[ \t]+$/;
        trimBoth = /^[ \t]+|[ \t]+$/g;
      }
      let res = match[1].replace(trimEnd, "");
      let sep = " ";
      let pos = line.lastIndex;
      while (match = line.exec(source)) {
        const lm = match[1].replace(trimBoth, "");
        if (lm === "") {
          if (sep === "\n")
            res += sep;
          else
            sep = "\n";
        } else {
          res += sep + lm;
          sep = " ";
        }
        pos = line.lastIndex;
      }
      const last = /[ \t]*(.*)/sy;
      last.lastIndex = pos;
      match = last.exec(source);
      return res + sep + (match?.[1] ?? "");
    }
    function doubleQuotedValue(source, onError) {
      let res = "";
      for (let i = 1; i < source.length - 1; ++i) {
        const ch = source[i];
        if (ch === "\r" && source[i + 1] === "\n")
          continue;
        if (ch === "\n") {
          const { fold, offset } = foldNewline(source, i);
          res += fold;
          i = offset;
        } else if (ch === "\\") {
          let next = source[++i];
          const cc = escapeCodes[next];
          if (cc)
            res += cc;
          else if (next === "\n") {
            next = source[i + 1];
            while (next === " " || next === "	")
              next = source[++i + 1];
          } else if (next === "\r" && source[i + 1] === "\n") {
            next = source[++i + 1];
            while (next === " " || next === "	")
              next = source[++i + 1];
          } else if (next === "x" || next === "u" || next === "U") {
            const length = next === "x" ? 2 : next === "u" ? 4 : 8;
            res += parseCharCode(source, i + 1, length, onError);
            i += length;
          } else {
            const raw = source.substr(i - 1, 2);
            onError(i - 1, "BAD_DQ_ESCAPE", `Invalid escape sequence ${raw}`);
            res += raw;
          }
        } else if (ch === " " || ch === "	") {
          const wsStart = i;
          let next = source[i + 1];
          while (next === " " || next === "	")
            next = source[++i + 1];
          if (next !== "\n" && !(next === "\r" && source[i + 2] === "\n"))
            res += i > wsStart ? source.slice(wsStart, i + 1) : ch;
        } else {
          res += ch;
        }
      }
      if (source[source.length - 1] !== '"' || source.length === 1)
        onError(source.length, "MISSING_CHAR", 'Missing closing "quote');
      return res;
    }
    function foldNewline(source, offset) {
      let fold = "";
      let ch = source[offset + 1];
      while (ch === " " || ch === "	" || ch === "\n" || ch === "\r") {
        if (ch === "\r" && source[offset + 2] !== "\n")
          break;
        if (ch === "\n")
          fold += "\n";
        offset += 1;
        ch = source[offset + 1];
      }
      if (!fold)
        fold = " ";
      return { fold, offset };
    }
    var escapeCodes = {
      "0": "\0",
      // null character
      a: "\x07",
      // bell character
      b: "\b",
      // backspace
      e: "\x1B",
      // escape character
      f: "\f",
      // form feed
      n: "\n",
      // line feed
      r: "\r",
      // carriage return
      t: "	",
      // horizontal tab
      v: "\v",
      // vertical tab
      N: "\x85",
      // Unicode next line
      _: "\xA0",
      // Unicode non-breaking space
      L: "\u2028",
      // Unicode line separator
      P: "\u2029",
      // Unicode paragraph separator
      " ": " ",
      '"': '"',
      "/": "/",
      "\\": "\\",
      "	": "	"
    };
    function parseCharCode(source, offset, length, onError) {
      const cc = source.substr(offset, length);
      const ok = cc.length === length && /^[0-9a-fA-F]+$/.test(cc);
      const code = ok ? parseInt(cc, 16) : NaN;
      try {
        return String.fromCodePoint(code);
      } catch {
        const raw = source.substr(offset - 2, length + 2);
        onError(offset - 2, "BAD_DQ_ESCAPE", `Invalid escape sequence ${raw}`);
        return raw;
      }
    }
    exports2.resolveFlowScalar = resolveFlowScalar;
  }
});

// node_modules/yaml/dist/compose/compose-scalar.js
var require_compose_scalar = __commonJS({
  "node_modules/yaml/dist/compose/compose-scalar.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var resolveBlockScalar = require_resolve_block_scalar();
    var resolveFlowScalar = require_resolve_flow_scalar();
    function composeScalar(ctx, token, tagToken, onError) {
      const { value, type, comment, range } = token.type === "block-scalar" ? resolveBlockScalar.resolveBlockScalar(ctx, token, onError) : resolveFlowScalar.resolveFlowScalar(token, ctx.options.strict, onError);
      const tagName = tagToken ? ctx.directives.tagName(tagToken.source, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg)) : null;
      let tag;
      if (ctx.options.stringKeys && ctx.atKey) {
        tag = ctx.schema[identity.SCALAR];
      } else if (tagName)
        tag = findScalarTagByName(ctx.schema, value, tagName, tagToken, onError);
      else if (token.type === "scalar")
        tag = findScalarTagByTest(ctx, value, token, onError);
      else
        tag = ctx.schema[identity.SCALAR];
      let scalar;
      try {
        const res = tag.resolve(value, (msg) => onError(tagToken ?? token, "TAG_RESOLVE_FAILED", msg), ctx.options);
        scalar = identity.isScalar(res) ? res : new Scalar.Scalar(res);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        onError(tagToken ?? token, "TAG_RESOLVE_FAILED", msg);
        scalar = new Scalar.Scalar(value);
      }
      scalar.range = range;
      scalar.source = value;
      if (type)
        scalar.type = type;
      if (tagName)
        scalar.tag = tagName;
      if (tag.format)
        scalar.format = tag.format;
      if (comment)
        scalar.comment = comment;
      return scalar;
    }
    function findScalarTagByName(schema, value, tagName, tagToken, onError) {
      if (tagName === "!")
        return schema[identity.SCALAR];
      const matchWithTest = [];
      for (const tag of schema.tags) {
        if (!tag.collection && tag.tag === tagName) {
          if (tag.default && tag.test)
            matchWithTest.push(tag);
          else
            return tag;
        }
      }
      for (const tag of matchWithTest)
        if (tag.test?.test(value))
          return tag;
      const kt = schema.knownTags[tagName];
      if (kt && !kt.collection) {
        schema.tags.push(Object.assign({}, kt, { default: false, test: void 0 }));
        return kt;
      }
      onError(tagToken, "TAG_RESOLVE_FAILED", `Unresolved tag: ${tagName}`, tagName !== "tag:yaml.org,2002:str");
      return schema[identity.SCALAR];
    }
    function findScalarTagByTest({ atKey, directives, schema }, value, token, onError) {
      const tag = schema.tags.find((tag2) => (tag2.default === true || atKey && tag2.default === "key") && tag2.test?.test(value)) || schema[identity.SCALAR];
      if (schema.compat) {
        const compat = schema.compat.find((tag2) => tag2.default && tag2.test?.test(value)) ?? schema[identity.SCALAR];
        if (tag.tag !== compat.tag) {
          const ts = directives.tagString(tag.tag);
          const cs = directives.tagString(compat.tag);
          const msg = `Value may be parsed as either ${ts} or ${cs}`;
          onError(token, "TAG_RESOLVE_FAILED", msg, true);
        }
      }
      return tag;
    }
    exports2.composeScalar = composeScalar;
  }
});

// node_modules/yaml/dist/compose/util-empty-scalar-position.js
var require_util_empty_scalar_position = __commonJS({
  "node_modules/yaml/dist/compose/util-empty-scalar-position.js"(exports2) {
    "use strict";
    function emptyScalarPosition(offset, before, pos) {
      if (before) {
        pos ?? (pos = before.length);
        for (let i = pos - 1; i >= 0; --i) {
          let st = before[i];
          switch (st.type) {
            case "space":
            case "comment":
            case "newline":
              offset -= st.source.length;
              continue;
          }
          st = before[++i];
          while (st?.type === "space") {
            offset += st.source.length;
            st = before[++i];
          }
          break;
        }
      }
      return offset;
    }
    exports2.emptyScalarPosition = emptyScalarPosition;
  }
});

// node_modules/yaml/dist/compose/compose-node.js
var require_compose_node = __commonJS({
  "node_modules/yaml/dist/compose/compose-node.js"(exports2) {
    "use strict";
    var Alias = require_Alias();
    var identity = require_identity();
    var composeCollection = require_compose_collection();
    var composeScalar = require_compose_scalar();
    var resolveEnd = require_resolve_end();
    var utilEmptyScalarPosition = require_util_empty_scalar_position();
    var CN = { composeNode, composeEmptyNode };
    function composeNode(ctx, token, props, onError) {
      const atKey = ctx.atKey;
      const { spaceBefore, comment, anchor, tag } = props;
      let node;
      let isSrcToken = true;
      switch (token.type) {
        case "alias":
          node = composeAlias(ctx, token, onError);
          if (anchor || tag)
            onError(token, "ALIAS_PROPS", "An alias node must not specify any properties");
          break;
        case "scalar":
        case "single-quoted-scalar":
        case "double-quoted-scalar":
        case "block-scalar":
          node = composeScalar.composeScalar(ctx, token, tag, onError);
          if (anchor)
            node.anchor = anchor.source.substring(1);
          break;
        case "block-map":
        case "block-seq":
        case "flow-collection":
          try {
            node = composeCollection.composeCollection(CN, ctx, token, props, onError);
            if (anchor)
              node.anchor = anchor.source.substring(1);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            onError(token, "RESOURCE_EXHAUSTION", message);
          }
          break;
        default: {
          const message = token.type === "error" ? token.message : `Unsupported token (type: ${token.type})`;
          onError(token, "UNEXPECTED_TOKEN", message);
          isSrcToken = false;
        }
      }
      node ?? (node = composeEmptyNode(ctx, token.offset, void 0, null, props, onError));
      if (anchor && node.anchor === "")
        onError(anchor, "BAD_ALIAS", "Anchor cannot be an empty string");
      if (atKey && ctx.options.stringKeys && (!identity.isScalar(node) || typeof node.value !== "string" || node.tag && node.tag !== "tag:yaml.org,2002:str")) {
        const msg = "With stringKeys, all keys must be strings";
        onError(tag ?? token, "NON_STRING_KEY", msg);
      }
      if (spaceBefore)
        node.spaceBefore = true;
      if (comment) {
        if (token.type === "scalar" && token.source === "")
          node.comment = comment;
        else
          node.commentBefore = comment;
      }
      if (ctx.options.keepSourceTokens && isSrcToken)
        node.srcToken = token;
      return node;
    }
    function composeEmptyNode(ctx, offset, before, pos, { spaceBefore, comment, anchor, tag, end }, onError) {
      const token = {
        type: "scalar",
        offset: utilEmptyScalarPosition.emptyScalarPosition(offset, before, pos),
        indent: -1,
        source: ""
      };
      const node = composeScalar.composeScalar(ctx, token, tag, onError);
      if (anchor) {
        node.anchor = anchor.source.substring(1);
        if (node.anchor === "")
          onError(anchor, "BAD_ALIAS", "Anchor cannot be an empty string");
      }
      if (spaceBefore)
        node.spaceBefore = true;
      if (comment) {
        node.comment = comment;
        node.range[2] = end;
      }
      return node;
    }
    function composeAlias({ options }, { offset, source, end }, onError) {
      const alias = new Alias.Alias(source.substring(1));
      if (alias.source === "")
        onError(offset, "BAD_ALIAS", "Alias cannot be an empty string");
      if (alias.source.endsWith(":"))
        onError(offset + source.length - 1, "BAD_ALIAS", "Alias ending in : is ambiguous", true);
      const valueEnd = offset + source.length;
      const re = resolveEnd.resolveEnd(end, valueEnd, options.strict, onError);
      alias.range = [offset, valueEnd, re.offset];
      if (re.comment)
        alias.comment = re.comment;
      return alias;
    }
    exports2.composeEmptyNode = composeEmptyNode;
    exports2.composeNode = composeNode;
  }
});

// node_modules/yaml/dist/compose/compose-doc.js
var require_compose_doc = __commonJS({
  "node_modules/yaml/dist/compose/compose-doc.js"(exports2) {
    "use strict";
    var Document = require_Document();
    var composeNode = require_compose_node();
    var resolveEnd = require_resolve_end();
    var resolveProps = require_resolve_props();
    function composeDoc(options, directives, { offset, start, value, end }, onError) {
      const opts = Object.assign({ _directives: directives }, options);
      const doc = new Document.Document(void 0, opts);
      const ctx = {
        atKey: false,
        atRoot: true,
        directives: doc.directives,
        options: doc.options,
        schema: doc.schema
      };
      const props = resolveProps.resolveProps(start, {
        indicator: "doc-start",
        next: value ?? end?.[0],
        offset,
        onError,
        parentIndent: 0,
        startOnNewline: true
      });
      if (props.found) {
        doc.directives.docStart = true;
        if (value && (value.type === "block-map" || value.type === "block-seq") && !props.hasNewline)
          onError(props.end, "MISSING_CHAR", "Block collection cannot start on same line with directives-end marker");
      }
      doc.contents = value ? composeNode.composeNode(ctx, value, props, onError) : composeNode.composeEmptyNode(ctx, props.end, start, null, props, onError);
      const contentEnd = doc.contents.range[2];
      const re = resolveEnd.resolveEnd(end, contentEnd, false, onError);
      if (re.comment)
        doc.comment = re.comment;
      doc.range = [offset, contentEnd, re.offset];
      return doc;
    }
    exports2.composeDoc = composeDoc;
  }
});

// node_modules/yaml/dist/compose/composer.js
var require_composer = __commonJS({
  "node_modules/yaml/dist/compose/composer.js"(exports2) {
    "use strict";
    var node_process = require("process");
    var directives = require_directives();
    var Document = require_Document();
    var errors = require_errors();
    var identity = require_identity();
    var composeDoc = require_compose_doc();
    var resolveEnd = require_resolve_end();
    function getErrorPos(src) {
      if (typeof src === "number")
        return [src, src + 1];
      if (Array.isArray(src))
        return src.length === 2 ? src : [src[0], src[1]];
      const { offset, source } = src;
      return [offset, offset + (typeof source === "string" ? source.length : 1)];
    }
    function parsePrelude(prelude) {
      let comment = "";
      let atComment = false;
      let afterEmptyLine = false;
      for (let i = 0; i < prelude.length; ++i) {
        const source = prelude[i];
        switch (source[0]) {
          case "#":
            comment += (comment === "" ? "" : afterEmptyLine ? "\n\n" : "\n") + (source.substring(1) || " ");
            atComment = true;
            afterEmptyLine = false;
            break;
          case "%":
            if (prelude[i + 1]?.[0] !== "#")
              i += 1;
            atComment = false;
            break;
          default:
            if (!atComment)
              afterEmptyLine = true;
            atComment = false;
        }
      }
      return { comment, afterEmptyLine };
    }
    var Composer = class {
      constructor(options = {}) {
        this.doc = null;
        this.atDirectives = false;
        this.prelude = [];
        this.errors = [];
        this.warnings = [];
        this.onError = (source, code, message, warning) => {
          const pos = getErrorPos(source);
          if (warning)
            this.warnings.push(new errors.YAMLWarning(pos, code, message));
          else
            this.errors.push(new errors.YAMLParseError(pos, code, message));
        };
        this.directives = new directives.Directives({ version: options.version || "1.2" });
        this.options = options;
      }
      decorate(doc, afterDoc) {
        const { comment, afterEmptyLine } = parsePrelude(this.prelude);
        if (comment) {
          const dc = doc.contents;
          if (afterDoc) {
            doc.comment = doc.comment ? `${doc.comment}
${comment}` : comment;
          } else if (afterEmptyLine || doc.directives.docStart || !dc) {
            doc.commentBefore = comment;
          } else if (identity.isCollection(dc) && !dc.flow && dc.items.length > 0) {
            let it = dc.items[0];
            if (identity.isPair(it))
              it = it.key;
            const cb = it.commentBefore;
            it.commentBefore = cb ? `${comment}
${cb}` : comment;
          } else {
            const cb = dc.commentBefore;
            dc.commentBefore = cb ? `${comment}
${cb}` : comment;
          }
        }
        if (afterDoc) {
          for (let i = 0; i < this.errors.length; ++i)
            doc.errors.push(this.errors[i]);
          for (let i = 0; i < this.warnings.length; ++i)
            doc.warnings.push(this.warnings[i]);
        } else {
          doc.errors = this.errors;
          doc.warnings = this.warnings;
        }
        this.prelude = [];
        this.errors = [];
        this.warnings = [];
      }
      /**
       * Current stream status information.
       *
       * Mostly useful at the end of input for an empty stream.
       */
      streamInfo() {
        return {
          comment: parsePrelude(this.prelude).comment,
          directives: this.directives,
          errors: this.errors,
          warnings: this.warnings
        };
      }
      /**
       * Compose tokens into documents.
       *
       * @param forceDoc - If the stream contains no document, still emit a final document including any comments and directives that would be applied to a subsequent document.
       * @param endOffset - Should be set if `forceDoc` is also set, to set the document range end and to indicate errors correctly.
       */
      *compose(tokens, forceDoc = false, endOffset = -1) {
        for (const token of tokens)
          yield* this.next(token);
        yield* this.end(forceDoc, endOffset);
      }
      /** Advance the composer by one CST token. */
      *next(token) {
        if (node_process.env.LOG_STREAM)
          console.dir(token, { depth: null });
        switch (token.type) {
          case "directive":
            this.directives.add(token.source, (offset, message, warning) => {
              const pos = getErrorPos(token);
              pos[0] += offset;
              this.onError(pos, "BAD_DIRECTIVE", message, warning);
            });
            this.prelude.push(token.source);
            this.atDirectives = true;
            break;
          case "document": {
            const doc = composeDoc.composeDoc(this.options, this.directives, token, this.onError);
            if (this.atDirectives && !doc.directives.docStart)
              this.onError(token, "MISSING_CHAR", "Missing directives-end/doc-start indicator line");
            this.decorate(doc, false);
            if (this.doc)
              yield this.doc;
            this.doc = doc;
            this.atDirectives = false;
            break;
          }
          case "byte-order-mark":
          case "space":
            break;
          case "comment":
          case "newline":
            this.prelude.push(token.source);
            break;
          case "error": {
            const msg = token.source ? `${token.message}: ${JSON.stringify(token.source)}` : token.message;
            const error = new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", msg);
            if (this.atDirectives || !this.doc)
              this.errors.push(error);
            else
              this.doc.errors.push(error);
            break;
          }
          case "doc-end": {
            if (!this.doc) {
              const msg = "Unexpected doc-end without preceding document";
              this.errors.push(new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", msg));
              break;
            }
            this.doc.directives.docEnd = true;
            const end = resolveEnd.resolveEnd(token.end, token.offset + token.source.length, this.doc.options.strict, this.onError);
            this.decorate(this.doc, true);
            if (end.comment) {
              const dc = this.doc.comment;
              this.doc.comment = dc ? `${dc}
${end.comment}` : end.comment;
            }
            this.doc.range[2] = end.offset;
            break;
          }
          default:
            this.errors.push(new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", `Unsupported token ${token.type}`));
        }
      }
      /**
       * Call at end of input to yield any remaining document.
       *
       * @param forceDoc - If the stream contains no document, still emit a final document including any comments and directives that would be applied to a subsequent document.
       * @param endOffset - Should be set if `forceDoc` is also set, to set the document range end and to indicate errors correctly.
       */
      *end(forceDoc = false, endOffset = -1) {
        if (this.doc) {
          this.decorate(this.doc, true);
          yield this.doc;
          this.doc = null;
        } else if (forceDoc) {
          const opts = Object.assign({ _directives: this.directives }, this.options);
          const doc = new Document.Document(void 0, opts);
          if (this.atDirectives)
            this.onError(endOffset, "MISSING_CHAR", "Missing directives-end indicator line");
          doc.range = [0, endOffset, endOffset];
          this.decorate(doc, false);
          yield doc;
        }
      }
    };
    exports2.Composer = Composer;
  }
});

// node_modules/yaml/dist/parse/cst-scalar.js
var require_cst_scalar = __commonJS({
  "node_modules/yaml/dist/parse/cst-scalar.js"(exports2) {
    "use strict";
    var resolveBlockScalar = require_resolve_block_scalar();
    var resolveFlowScalar = require_resolve_flow_scalar();
    var errors = require_errors();
    var stringifyString = require_stringifyString();
    function resolveAsScalar(token, strict = true, onError) {
      if (token) {
        const _onError = (pos, code, message) => {
          const offset = typeof pos === "number" ? pos : Array.isArray(pos) ? pos[0] : pos.offset;
          if (onError)
            onError(offset, code, message);
          else
            throw new errors.YAMLParseError([offset, offset + 1], code, message);
        };
        switch (token.type) {
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar":
            return resolveFlowScalar.resolveFlowScalar(token, strict, _onError);
          case "block-scalar":
            return resolveBlockScalar.resolveBlockScalar({ options: { strict } }, token, _onError);
        }
      }
      return null;
    }
    function createScalarToken(value, context) {
      const { implicitKey = false, indent, inFlow = false, offset = -1, type = "PLAIN" } = context;
      const source = stringifyString.stringifyString({ type, value }, {
        implicitKey,
        indent: indent > 0 ? " ".repeat(indent) : "",
        inFlow,
        options: { blockQuote: true, lineWidth: -1 }
      });
      const end = context.end ?? [
        { type: "newline", offset: -1, indent, source: "\n" }
      ];
      switch (source[0]) {
        case "|":
        case ">": {
          const he = source.indexOf("\n");
          const head = source.substring(0, he);
          const body = source.substring(he + 1) + "\n";
          const props = [
            { type: "block-scalar-header", offset, indent, source: head }
          ];
          if (!addEndtoBlockProps(props, end))
            props.push({ type: "newline", offset: -1, indent, source: "\n" });
          return { type: "block-scalar", offset, indent, props, source: body };
        }
        case '"':
          return { type: "double-quoted-scalar", offset, indent, source, end };
        case "'":
          return { type: "single-quoted-scalar", offset, indent, source, end };
        default:
          return { type: "scalar", offset, indent, source, end };
      }
    }
    function setScalarValue(token, value, context = {}) {
      let { afterKey = false, implicitKey = false, inFlow = false, type } = context;
      let indent = "indent" in token ? token.indent : null;
      if (afterKey && typeof indent === "number")
        indent += 2;
      if (!type)
        switch (token.type) {
          case "single-quoted-scalar":
            type = "QUOTE_SINGLE";
            break;
          case "double-quoted-scalar":
            type = "QUOTE_DOUBLE";
            break;
          case "block-scalar": {
            const header = token.props[0];
            if (header.type !== "block-scalar-header")
              throw new Error("Invalid block scalar header");
            type = header.source[0] === ">" ? "BLOCK_FOLDED" : "BLOCK_LITERAL";
            break;
          }
          default:
            type = "PLAIN";
        }
      const source = stringifyString.stringifyString({ type, value }, {
        implicitKey: implicitKey || indent === null,
        indent: indent !== null && indent > 0 ? " ".repeat(indent) : "",
        inFlow,
        options: { blockQuote: true, lineWidth: -1 }
      });
      switch (source[0]) {
        case "|":
        case ">":
          setBlockScalarValue(token, source);
          break;
        case '"':
          setFlowScalarValue(token, source, "double-quoted-scalar");
          break;
        case "'":
          setFlowScalarValue(token, source, "single-quoted-scalar");
          break;
        default:
          setFlowScalarValue(token, source, "scalar");
      }
    }
    function setBlockScalarValue(token, source) {
      const he = source.indexOf("\n");
      const head = source.substring(0, he);
      const body = source.substring(he + 1) + "\n";
      if (token.type === "block-scalar") {
        const header = token.props[0];
        if (header.type !== "block-scalar-header")
          throw new Error("Invalid block scalar header");
        header.source = head;
        token.source = body;
      } else {
        const { offset } = token;
        const indent = "indent" in token ? token.indent : -1;
        const props = [
          { type: "block-scalar-header", offset, indent, source: head }
        ];
        if (!addEndtoBlockProps(props, "end" in token ? token.end : void 0))
          props.push({ type: "newline", offset: -1, indent, source: "\n" });
        for (const key of Object.keys(token))
          if (key !== "type" && key !== "offset")
            delete token[key];
        Object.assign(token, { type: "block-scalar", indent, props, source: body });
      }
    }
    function addEndtoBlockProps(props, end) {
      if (end)
        for (const st of end)
          switch (st.type) {
            case "space":
            case "comment":
              props.push(st);
              break;
            case "newline":
              props.push(st);
              return true;
          }
      return false;
    }
    function setFlowScalarValue(token, source, type) {
      switch (token.type) {
        case "scalar":
        case "double-quoted-scalar":
        case "single-quoted-scalar":
          token.type = type;
          token.source = source;
          break;
        case "block-scalar": {
          const end = token.props.slice(1);
          let oa = source.length;
          if (token.props[0].type === "block-scalar-header")
            oa -= token.props[0].source.length;
          for (const tok of end)
            tok.offset += oa;
          delete token.props;
          Object.assign(token, { type, source, end });
          break;
        }
        case "block-map":
        case "block-seq": {
          const offset = token.offset + source.length;
          const nl = { type: "newline", offset, indent: token.indent, source: "\n" };
          delete token.items;
          Object.assign(token, { type, source, end: [nl] });
          break;
        }
        default: {
          const indent = "indent" in token ? token.indent : -1;
          const end = "end" in token && Array.isArray(token.end) ? token.end.filter((st) => st.type === "space" || st.type === "comment" || st.type === "newline") : [];
          for (const key of Object.keys(token))
            if (key !== "type" && key !== "offset")
              delete token[key];
          Object.assign(token, { type, indent, source, end });
        }
      }
    }
    exports2.createScalarToken = createScalarToken;
    exports2.resolveAsScalar = resolveAsScalar;
    exports2.setScalarValue = setScalarValue;
  }
});

// node_modules/yaml/dist/parse/cst-stringify.js
var require_cst_stringify = __commonJS({
  "node_modules/yaml/dist/parse/cst-stringify.js"(exports2) {
    "use strict";
    var stringify2 = (cst) => "type" in cst ? stringifyToken(cst) : stringifyItem(cst);
    function stringifyToken(token) {
      switch (token.type) {
        case "block-scalar": {
          let res = "";
          for (const tok of token.props)
            res += stringifyToken(tok);
          return res + token.source;
        }
        case "block-map":
        case "block-seq": {
          let res = "";
          for (const item of token.items)
            res += stringifyItem(item);
          return res;
        }
        case "flow-collection": {
          let res = token.start.source;
          for (const item of token.items)
            res += stringifyItem(item);
          for (const st of token.end)
            res += st.source;
          return res;
        }
        case "document": {
          let res = stringifyItem(token);
          if (token.end)
            for (const st of token.end)
              res += st.source;
          return res;
        }
        default: {
          let res = token.source;
          if ("end" in token && token.end)
            for (const st of token.end)
              res += st.source;
          return res;
        }
      }
    }
    function stringifyItem({ start, key, sep, value }) {
      let res = "";
      for (const st of start)
        res += st.source;
      if (key)
        res += stringifyToken(key);
      if (sep)
        for (const st of sep)
          res += st.source;
      if (value)
        res += stringifyToken(value);
      return res;
    }
    exports2.stringify = stringify2;
  }
});

// node_modules/yaml/dist/parse/cst-visit.js
var require_cst_visit = __commonJS({
  "node_modules/yaml/dist/parse/cst-visit.js"(exports2) {
    "use strict";
    var BREAK = Symbol("break visit");
    var SKIP = Symbol("skip children");
    var REMOVE = Symbol("remove item");
    function visit(cst, visitor) {
      if ("type" in cst && cst.type === "document")
        cst = { start: cst.start, value: cst.value };
      _visit(Object.freeze([]), cst, visitor);
    }
    visit.BREAK = BREAK;
    visit.SKIP = SKIP;
    visit.REMOVE = REMOVE;
    visit.itemAtPath = (cst, path17) => {
      let item = cst;
      for (const [field, index] of path17) {
        const tok = item?.[field];
        if (tok && "items" in tok) {
          item = tok.items[index];
        } else
          return void 0;
      }
      return item;
    };
    visit.parentCollection = (cst, path17) => {
      const parent = visit.itemAtPath(cst, path17.slice(0, -1));
      const field = path17[path17.length - 1][0];
      const coll = parent?.[field];
      if (coll && "items" in coll)
        return coll;
      throw new Error("Parent collection not found");
    };
    function _visit(path17, item, visitor) {
      let ctrl = visitor(item, path17);
      if (typeof ctrl === "symbol")
        return ctrl;
      for (const field of ["key", "value"]) {
        const token = item[field];
        if (token && "items" in token) {
          for (let i = 0; i < token.items.length; ++i) {
            const ci = _visit(Object.freeze(path17.concat([[field, i]])), token.items[i], visitor);
            if (typeof ci === "number")
              i = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              token.items.splice(i, 1);
              i -= 1;
            }
          }
          if (typeof ctrl === "function" && field === "key")
            ctrl = ctrl(item, path17);
        }
      }
      return typeof ctrl === "function" ? ctrl(item, path17) : ctrl;
    }
    exports2.visit = visit;
  }
});

// node_modules/yaml/dist/parse/cst.js
var require_cst = __commonJS({
  "node_modules/yaml/dist/parse/cst.js"(exports2) {
    "use strict";
    var cstScalar = require_cst_scalar();
    var cstStringify = require_cst_stringify();
    var cstVisit = require_cst_visit();
    var BOM = "\uFEFF";
    var DOCUMENT = "";
    var FLOW_END = "";
    var SCALAR = "";
    var isCollection = (token) => !!token && "items" in token;
    var isScalar = (token) => !!token && (token.type === "scalar" || token.type === "single-quoted-scalar" || token.type === "double-quoted-scalar" || token.type === "block-scalar");
    function prettyToken(token) {
      switch (token) {
        case BOM:
          return "<BOM>";
        case DOCUMENT:
          return "<DOC>";
        case FLOW_END:
          return "<FLOW_END>";
        case SCALAR:
          return "<SCALAR>";
        default:
          return JSON.stringify(token);
      }
    }
    function tokenType(source) {
      switch (source) {
        case BOM:
          return "byte-order-mark";
        case DOCUMENT:
          return "doc-mode";
        case FLOW_END:
          return "flow-error-end";
        case SCALAR:
          return "scalar";
        case "---":
          return "doc-start";
        case "...":
          return "doc-end";
        case "":
        case "\n":
        case "\r\n":
          return "newline";
        case "-":
          return "seq-item-ind";
        case "?":
          return "explicit-key-ind";
        case ":":
          return "map-value-ind";
        case "{":
          return "flow-map-start";
        case "}":
          return "flow-map-end";
        case "[":
          return "flow-seq-start";
        case "]":
          return "flow-seq-end";
        case ",":
          return "comma";
      }
      switch (source[0]) {
        case " ":
        case "	":
          return "space";
        case "#":
          return "comment";
        case "%":
          return "directive-line";
        case "*":
          return "alias";
        case "&":
          return "anchor";
        case "!":
          return "tag";
        case "'":
          return "single-quoted-scalar";
        case '"':
          return "double-quoted-scalar";
        case "|":
        case ">":
          return "block-scalar-header";
      }
      return null;
    }
    exports2.createScalarToken = cstScalar.createScalarToken;
    exports2.resolveAsScalar = cstScalar.resolveAsScalar;
    exports2.setScalarValue = cstScalar.setScalarValue;
    exports2.stringify = cstStringify.stringify;
    exports2.visit = cstVisit.visit;
    exports2.BOM = BOM;
    exports2.DOCUMENT = DOCUMENT;
    exports2.FLOW_END = FLOW_END;
    exports2.SCALAR = SCALAR;
    exports2.isCollection = isCollection;
    exports2.isScalar = isScalar;
    exports2.prettyToken = prettyToken;
    exports2.tokenType = tokenType;
  }
});

// node_modules/yaml/dist/parse/lexer.js
var require_lexer = __commonJS({
  "node_modules/yaml/dist/parse/lexer.js"(exports2) {
    "use strict";
    var cst = require_cst();
    function isEmpty(ch) {
      switch (ch) {
        case void 0:
        case " ":
        case "\n":
        case "\r":
        case "	":
          return true;
        default:
          return false;
      }
    }
    var hexDigits = new Set("0123456789ABCDEFabcdef");
    var tagChars = new Set("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-#;/?:@&=+$_.!~*'()");
    var flowIndicatorChars = new Set(",[]{}");
    var invalidAnchorChars = new Set(" ,[]{}\n\r	");
    var isNotAnchorChar = (ch) => !ch || invalidAnchorChars.has(ch);
    var Lexer = class {
      constructor() {
        this.atEnd = false;
        this.blockScalarIndent = -1;
        this.blockScalarKeep = false;
        this.buffer = "";
        this.flowKey = false;
        this.flowLevel = 0;
        this.indentNext = 0;
        this.indentValue = 0;
        this.lineEndPos = null;
        this.next = null;
        this.pos = 0;
      }
      /**
       * Generate YAML tokens from the `source` string. If `incomplete`,
       * a part of the last line may be left as a buffer for the next call.
       *
       * @returns A generator of lexical tokens
       */
      *lex(source, incomplete = false) {
        if (source) {
          if (typeof source !== "string")
            throw TypeError("source is not a string");
          this.buffer = this.buffer ? this.buffer + source : source;
          this.lineEndPos = null;
        }
        this.atEnd = !incomplete;
        let next = this.next ?? "stream";
        while (next && (incomplete || this.hasChars(1)))
          next = yield* this.parseNext(next);
      }
      atLineEnd() {
        let i = this.pos;
        let ch = this.buffer[i];
        while (ch === " " || ch === "	")
          ch = this.buffer[++i];
        if (!ch || ch === "#" || ch === "\n")
          return true;
        if (ch === "\r")
          return this.buffer[i + 1] === "\n";
        return false;
      }
      charAt(n) {
        return this.buffer[this.pos + n];
      }
      continueScalar(offset) {
        let ch = this.buffer[offset];
        if (this.indentNext > 0) {
          let indent = 0;
          while (ch === " ")
            ch = this.buffer[++indent + offset];
          if (ch === "\r") {
            const next = this.buffer[indent + offset + 1];
            if (next === "\n" || !next && !this.atEnd)
              return offset + indent + 1;
          }
          return ch === "\n" || indent >= this.indentNext || !ch && !this.atEnd ? offset + indent : -1;
        }
        if (ch === "-" || ch === ".") {
          const dt = this.buffer.substr(offset, 3);
          if ((dt === "---" || dt === "...") && isEmpty(this.buffer[offset + 3]))
            return -1;
        }
        return offset;
      }
      getLine() {
        let end = this.lineEndPos;
        if (typeof end !== "number" || end !== -1 && end < this.pos) {
          end = this.buffer.indexOf("\n", this.pos);
          this.lineEndPos = end;
        }
        if (end === -1)
          return this.atEnd ? this.buffer.substring(this.pos) : null;
        if (this.buffer[end - 1] === "\r")
          end -= 1;
        return this.buffer.substring(this.pos, end);
      }
      hasChars(n) {
        return this.pos + n <= this.buffer.length;
      }
      setNext(state) {
        this.buffer = this.buffer.substring(this.pos);
        this.pos = 0;
        this.lineEndPos = null;
        this.next = state;
        return null;
      }
      peek(n) {
        return this.buffer.substr(this.pos, n);
      }
      *parseNext(next) {
        switch (next) {
          case "stream":
            return yield* this.parseStream();
          case "line-start":
            return yield* this.parseLineStart();
          case "block-start":
            return yield* this.parseBlockStart();
          case "doc":
            return yield* this.parseDocument();
          case "flow":
            return yield* this.parseFlowCollection();
          case "quoted-scalar":
            return yield* this.parseQuotedScalar();
          case "block-scalar":
            return yield* this.parseBlockScalar();
          case "plain-scalar":
            return yield* this.parsePlainScalar();
        }
      }
      *parseStream() {
        let line = this.getLine();
        if (line === null)
          return this.setNext("stream");
        if (line[0] === cst.BOM) {
          yield* this.pushCount(1);
          line = line.substring(1);
        }
        if (line[0] === "%") {
          let dirEnd = line.length;
          let cs = line.indexOf("#");
          while (cs !== -1) {
            const ch = line[cs - 1];
            if (ch === " " || ch === "	") {
              dirEnd = cs - 1;
              break;
            } else {
              cs = line.indexOf("#", cs + 1);
            }
          }
          while (true) {
            const ch = line[dirEnd - 1];
            if (ch === " " || ch === "	")
              dirEnd -= 1;
            else
              break;
          }
          const n = (yield* this.pushCount(dirEnd)) + (yield* this.pushSpaces(true));
          yield* this.pushCount(line.length - n);
          this.pushNewline();
          return "stream";
        }
        if (this.atLineEnd()) {
          const sp = yield* this.pushSpaces(true);
          yield* this.pushCount(line.length - sp);
          yield* this.pushNewline();
          return "stream";
        }
        yield cst.DOCUMENT;
        return yield* this.parseLineStart();
      }
      *parseLineStart() {
        const ch = this.charAt(0);
        if (!ch && !this.atEnd)
          return this.setNext("line-start");
        if (ch === "-" || ch === ".") {
          if (!this.atEnd && !this.hasChars(4))
            return this.setNext("line-start");
          const s2 = this.peek(3);
          if ((s2 === "---" || s2 === "...") && isEmpty(this.charAt(3))) {
            yield* this.pushCount(3);
            this.indentValue = 0;
            this.indentNext = 0;
            return s2 === "---" ? "doc" : "stream";
          }
        }
        this.indentValue = yield* this.pushSpaces(false);
        if (this.indentNext > this.indentValue && !isEmpty(this.charAt(1)))
          this.indentNext = this.indentValue;
        return yield* this.parseBlockStart();
      }
      *parseBlockStart() {
        const [ch0, ch1] = this.peek(2);
        if (!ch1 && !this.atEnd)
          return this.setNext("block-start");
        if ((ch0 === "-" || ch0 === "?" || ch0 === ":") && isEmpty(ch1)) {
          const n = (yield* this.pushCount(1)) + (yield* this.pushSpaces(true));
          this.indentNext = this.indentValue + 1;
          this.indentValue += n;
          return "block-start";
        }
        return "doc";
      }
      *parseDocument() {
        yield* this.pushSpaces(true);
        const line = this.getLine();
        if (line === null)
          return this.setNext("doc");
        let n = yield* this.pushIndicators();
        switch (line[n]) {
          case "#":
            yield* this.pushCount(line.length - n);
          // fallthrough
          case void 0:
            yield* this.pushNewline();
            return yield* this.parseLineStart();
          case "{":
          case "[":
            yield* this.pushCount(1);
            this.flowKey = false;
            this.flowLevel = 1;
            return "flow";
          case "}":
          case "]":
            yield* this.pushCount(1);
            return "doc";
          case "*":
            yield* this.pushUntil(isNotAnchorChar);
            return "doc";
          case '"':
          case "'":
            return yield* this.parseQuotedScalar();
          case "|":
          case ">":
            n += yield* this.parseBlockScalarHeader();
            n += yield* this.pushSpaces(true);
            yield* this.pushCount(line.length - n);
            yield* this.pushNewline();
            return yield* this.parseBlockScalar();
          default:
            return yield* this.parsePlainScalar();
        }
      }
      *parseFlowCollection() {
        let nl, sp;
        let indent = -1;
        do {
          nl = yield* this.pushNewline();
          if (nl > 0) {
            sp = yield* this.pushSpaces(false);
            this.indentValue = indent = sp;
          } else {
            sp = 0;
          }
          sp += yield* this.pushSpaces(true);
        } while (nl + sp > 0);
        const line = this.getLine();
        if (line === null)
          return this.setNext("flow");
        if (indent !== -1 && indent < this.indentNext && line[0] !== "#" || indent === 0 && (line.startsWith("---") || line.startsWith("...")) && isEmpty(line[3])) {
          const atFlowEndMarker = indent === this.indentNext - 1 && this.flowLevel === 1 && (line[0] === "]" || line[0] === "}");
          if (!atFlowEndMarker) {
            this.flowLevel = 0;
            yield cst.FLOW_END;
            return yield* this.parseLineStart();
          }
        }
        let n = 0;
        while (line[n] === ",") {
          n += yield* this.pushCount(1);
          n += yield* this.pushSpaces(true);
          this.flowKey = false;
        }
        n += yield* this.pushIndicators();
        switch (line[n]) {
          case void 0:
            return "flow";
          case "#":
            yield* this.pushCount(line.length - n);
            return "flow";
          case "{":
          case "[":
            yield* this.pushCount(1);
            this.flowKey = false;
            this.flowLevel += 1;
            return "flow";
          case "}":
          case "]":
            yield* this.pushCount(1);
            this.flowKey = true;
            this.flowLevel -= 1;
            return this.flowLevel ? "flow" : "doc";
          case "*":
            yield* this.pushUntil(isNotAnchorChar);
            return "flow";
          case '"':
          case "'":
            this.flowKey = true;
            return yield* this.parseQuotedScalar();
          case ":": {
            const next = this.charAt(1);
            if (this.flowKey || isEmpty(next) || next === ",") {
              this.flowKey = false;
              yield* this.pushCount(1);
              yield* this.pushSpaces(true);
              return "flow";
            }
          }
          // fallthrough
          default:
            this.flowKey = false;
            return yield* this.parsePlainScalar();
        }
      }
      *parseQuotedScalar() {
        const quote = this.charAt(0);
        let end = this.buffer.indexOf(quote, this.pos + 1);
        if (quote === "'") {
          while (end !== -1 && this.buffer[end + 1] === "'")
            end = this.buffer.indexOf("'", end + 2);
        } else {
          while (end !== -1) {
            let n = 0;
            while (this.buffer[end - 1 - n] === "\\")
              n += 1;
            if (n % 2 === 0)
              break;
            end = this.buffer.indexOf('"', end + 1);
          }
        }
        const qb = this.buffer.substring(0, end);
        let nl = qb.indexOf("\n", this.pos);
        if (nl !== -1) {
          while (nl !== -1) {
            const cs = this.continueScalar(nl + 1);
            if (cs === -1)
              break;
            nl = qb.indexOf("\n", cs);
          }
          if (nl !== -1) {
            end = nl - (qb[nl - 1] === "\r" ? 2 : 1);
          }
        }
        if (end === -1) {
          if (!this.atEnd)
            return this.setNext("quoted-scalar");
          end = this.buffer.length;
        }
        yield* this.pushToIndex(end + 1, false);
        return this.flowLevel ? "flow" : "doc";
      }
      *parseBlockScalarHeader() {
        this.blockScalarIndent = -1;
        this.blockScalarKeep = false;
        let i = this.pos;
        while (true) {
          const ch = this.buffer[++i];
          if (ch === "+")
            this.blockScalarKeep = true;
          else if (ch > "0" && ch <= "9")
            this.blockScalarIndent = Number(ch) - 1;
          else if (ch !== "-")
            break;
        }
        return yield* this.pushUntil((ch) => isEmpty(ch) || ch === "#");
      }
      *parseBlockScalar() {
        let nl = this.pos - 1;
        let indent = 0;
        let ch;
        loop: for (let i2 = this.pos; ch = this.buffer[i2]; ++i2) {
          switch (ch) {
            case " ":
              indent += 1;
              break;
            case "\n":
              nl = i2;
              indent = 0;
              break;
            case "\r": {
              const next = this.buffer[i2 + 1];
              if (!next && !this.atEnd)
                return this.setNext("block-scalar");
              if (next === "\n")
                break;
            }
            // fallthrough
            default:
              break loop;
          }
        }
        if (!ch && !this.atEnd)
          return this.setNext("block-scalar");
        if (indent >= this.indentNext) {
          if (this.blockScalarIndent === -1)
            this.indentNext = indent;
          else {
            this.indentNext = this.blockScalarIndent + (this.indentNext === 0 ? 1 : this.indentNext);
          }
          do {
            const cs = this.continueScalar(nl + 1);
            if (cs === -1)
              break;
            nl = this.buffer.indexOf("\n", cs);
          } while (nl !== -1);
          if (nl === -1) {
            if (!this.atEnd)
              return this.setNext("block-scalar");
            nl = this.buffer.length;
          }
        }
        let i = nl + 1;
        ch = this.buffer[i];
        while (ch === " ")
          ch = this.buffer[++i];
        if (ch === "	") {
          while (ch === "	" || ch === " " || ch === "\r" || ch === "\n")
            ch = this.buffer[++i];
          nl = i - 1;
        } else if (!this.blockScalarKeep) {
          do {
            let i2 = nl - 1;
            let ch2 = this.buffer[i2];
            if (ch2 === "\r")
              ch2 = this.buffer[--i2];
            const lastChar = i2;
            while (ch2 === " ")
              ch2 = this.buffer[--i2];
            if (ch2 === "\n" && i2 >= this.pos && i2 + 1 + indent > lastChar)
              nl = i2;
            else
              break;
          } while (true);
        }
        yield cst.SCALAR;
        yield* this.pushToIndex(nl + 1, true);
        return yield* this.parseLineStart();
      }
      *parsePlainScalar() {
        const inFlow = this.flowLevel > 0;
        let end = this.pos - 1;
        let i = this.pos - 1;
        let ch;
        while (ch = this.buffer[++i]) {
          if (ch === ":") {
            const next = this.buffer[i + 1];
            if (isEmpty(next) || inFlow && flowIndicatorChars.has(next))
              break;
            end = i;
          } else if (isEmpty(ch)) {
            let next = this.buffer[i + 1];
            if (ch === "\r") {
              if (next === "\n") {
                i += 1;
                ch = "\n";
                next = this.buffer[i + 1];
              } else
                end = i;
            }
            if (next === "#" || inFlow && flowIndicatorChars.has(next))
              break;
            if (ch === "\n") {
              const cs = this.continueScalar(i + 1);
              if (cs === -1)
                break;
              i = Math.max(i, cs - 2);
            }
          } else {
            if (inFlow && flowIndicatorChars.has(ch))
              break;
            end = i;
          }
        }
        if (!ch && !this.atEnd)
          return this.setNext("plain-scalar");
        yield cst.SCALAR;
        yield* this.pushToIndex(end + 1, true);
        return inFlow ? "flow" : "doc";
      }
      *pushCount(n) {
        if (n > 0) {
          yield this.buffer.substr(this.pos, n);
          this.pos += n;
          return n;
        }
        return 0;
      }
      *pushToIndex(i, allowEmpty) {
        const s2 = this.buffer.slice(this.pos, i);
        if (s2) {
          yield s2;
          this.pos += s2.length;
          return s2.length;
        } else if (allowEmpty)
          yield "";
        return 0;
      }
      *pushIndicators() {
        let n = 0;
        loop: while (true) {
          switch (this.charAt(0)) {
            case "!":
              n += yield* this.pushTag();
              n += yield* this.pushSpaces(true);
              continue loop;
            case "&":
              n += yield* this.pushUntil(isNotAnchorChar);
              n += yield* this.pushSpaces(true);
              continue loop;
            case "-":
            // this is an error
            case "?":
            // this is an error outside flow collections
            case ":": {
              const inFlow = this.flowLevel > 0;
              const ch1 = this.charAt(1);
              if (isEmpty(ch1) || inFlow && flowIndicatorChars.has(ch1)) {
                if (!inFlow)
                  this.indentNext = this.indentValue + 1;
                else if (this.flowKey)
                  this.flowKey = false;
                n += yield* this.pushCount(1);
                n += yield* this.pushSpaces(true);
                continue loop;
              }
            }
          }
          break loop;
        }
        return n;
      }
      *pushTag() {
        if (this.charAt(1) === "<") {
          let i = this.pos + 2;
          let ch = this.buffer[i];
          while (!isEmpty(ch) && ch !== ">")
            ch = this.buffer[++i];
          return yield* this.pushToIndex(ch === ">" ? i + 1 : i, false);
        } else {
          let i = this.pos + 1;
          let ch = this.buffer[i];
          while (ch) {
            if (tagChars.has(ch))
              ch = this.buffer[++i];
            else if (ch === "%" && hexDigits.has(this.buffer[i + 1]) && hexDigits.has(this.buffer[i + 2])) {
              ch = this.buffer[i += 3];
            } else
              break;
          }
          return yield* this.pushToIndex(i, false);
        }
      }
      *pushNewline() {
        const ch = this.buffer[this.pos];
        if (ch === "\n")
          return yield* this.pushCount(1);
        else if (ch === "\r" && this.charAt(1) === "\n")
          return yield* this.pushCount(2);
        else
          return 0;
      }
      *pushSpaces(allowTabs) {
        let i = this.pos - 1;
        let ch;
        do {
          ch = this.buffer[++i];
        } while (ch === " " || allowTabs && ch === "	");
        const n = i - this.pos;
        if (n > 0) {
          yield this.buffer.substr(this.pos, n);
          this.pos = i;
        }
        return n;
      }
      *pushUntil(test) {
        let i = this.pos;
        let ch = this.buffer[i];
        while (!test(ch))
          ch = this.buffer[++i];
        return yield* this.pushToIndex(i, false);
      }
    };
    exports2.Lexer = Lexer;
  }
});

// node_modules/yaml/dist/parse/line-counter.js
var require_line_counter = __commonJS({
  "node_modules/yaml/dist/parse/line-counter.js"(exports2) {
    "use strict";
    var LineCounter = class {
      constructor() {
        this.lineStarts = [];
        this.addNewLine = (offset) => this.lineStarts.push(offset);
        this.linePos = (offset) => {
          let low = 0;
          let high = this.lineStarts.length;
          while (low < high) {
            const mid = low + high >> 1;
            if (this.lineStarts[mid] < offset)
              low = mid + 1;
            else
              high = mid;
          }
          if (this.lineStarts[low] === offset)
            return { line: low + 1, col: 1 };
          if (low === 0)
            return { line: 0, col: offset };
          const start = this.lineStarts[low - 1];
          return { line: low, col: offset - start + 1 };
        };
      }
    };
    exports2.LineCounter = LineCounter;
  }
});

// node_modules/yaml/dist/parse/parser.js
var require_parser = __commonJS({
  "node_modules/yaml/dist/parse/parser.js"(exports2) {
    "use strict";
    var node_process = require("process");
    var cst = require_cst();
    var lexer = require_lexer();
    function includesToken(list, type) {
      for (let i = 0; i < list.length; ++i)
        if (list[i].type === type)
          return true;
      return false;
    }
    function findNonEmptyIndex(list) {
      for (let i = 0; i < list.length; ++i) {
        switch (list[i].type) {
          case "space":
          case "comment":
          case "newline":
            break;
          default:
            return i;
        }
      }
      return -1;
    }
    function isFlowToken(token) {
      switch (token?.type) {
        case "alias":
        case "scalar":
        case "single-quoted-scalar":
        case "double-quoted-scalar":
        case "flow-collection":
          return true;
        default:
          return false;
      }
    }
    function getPrevProps(parent) {
      switch (parent.type) {
        case "document":
          return parent.start;
        case "block-map": {
          const it = parent.items[parent.items.length - 1];
          return it.sep ?? it.start;
        }
        case "block-seq":
          return parent.items[parent.items.length - 1].start;
        /* istanbul ignore next should not happen */
        default:
          return [];
      }
    }
    function getFirstKeyStartProps(prev) {
      if (prev.length === 0)
        return [];
      let i = prev.length;
      loop: while (--i >= 0) {
        switch (prev[i].type) {
          case "doc-start":
          case "explicit-key-ind":
          case "map-value-ind":
          case "seq-item-ind":
          case "newline":
            break loop;
        }
      }
      while (prev[++i]?.type === "space") {
      }
      return prev.splice(i, prev.length);
    }
    function arrayPushArray(target, source) {
      if (source.length < 1e5)
        Array.prototype.push.apply(target, source);
      else
        for (let i = 0; i < source.length; ++i)
          target.push(source[i]);
    }
    function fixFlowSeqItems(fc) {
      if (fc.start.type === "flow-seq-start") {
        for (const it of fc.items) {
          if (it.sep && !it.value && !includesToken(it.start, "explicit-key-ind") && !includesToken(it.sep, "map-value-ind")) {
            if (it.key)
              it.value = it.key;
            delete it.key;
            if (isFlowToken(it.value)) {
              if (it.value.end)
                arrayPushArray(it.value.end, it.sep);
              else
                it.value.end = it.sep;
            } else
              arrayPushArray(it.start, it.sep);
            delete it.sep;
          }
        }
      }
    }
    var Parser = class {
      /**
       * @param onNewLine - If defined, called separately with the start position of
       *   each new line (in `parse()`, including the start of input).
       */
      constructor(onNewLine) {
        this.atNewLine = true;
        this.atScalar = false;
        this.indent = 0;
        this.offset = 0;
        this.onKeyLine = false;
        this.stack = [];
        this.source = "";
        this.type = "";
        this.lexer = new lexer.Lexer();
        this.onNewLine = onNewLine;
      }
      /**
       * Parse `source` as a YAML stream.
       * If `incomplete`, a part of the last line may be left as a buffer for the next call.
       *
       * Errors are not thrown, but yielded as `{ type: 'error', message }` tokens.
       *
       * @returns A generator of tokens representing each directive, document, and other structure.
       */
      *parse(source, incomplete = false) {
        if (this.onNewLine && this.offset === 0)
          this.onNewLine(0);
        for (const lexeme of this.lexer.lex(source, incomplete))
          yield* this.next(lexeme);
        if (!incomplete)
          yield* this.end();
      }
      /**
       * Advance the parser by the `source` of one lexical token.
       */
      *next(source) {
        this.source = source;
        if (node_process.env.LOG_TOKENS)
          console.log("|", cst.prettyToken(source));
        if (this.atScalar) {
          this.atScalar = false;
          yield* this.step();
          this.offset += source.length;
          return;
        }
        const type = cst.tokenType(source);
        if (!type) {
          const message = `Not a YAML token: ${source}`;
          yield* this.pop({ type: "error", offset: this.offset, message, source });
          this.offset += source.length;
        } else if (type === "scalar") {
          this.atNewLine = false;
          this.atScalar = true;
          this.type = "scalar";
        } else {
          this.type = type;
          yield* this.step();
          switch (type) {
            case "newline":
              this.atNewLine = true;
              this.indent = 0;
              if (this.onNewLine)
                this.onNewLine(this.offset + source.length);
              break;
            case "space":
              if (this.atNewLine && source[0] === " ")
                this.indent += source.length;
              break;
            case "explicit-key-ind":
            case "map-value-ind":
            case "seq-item-ind":
              if (this.atNewLine)
                this.indent += source.length;
              break;
            case "doc-mode":
            case "flow-error-end":
              return;
            default:
              this.atNewLine = false;
          }
          this.offset += source.length;
        }
      }
      /** Call at end of input to push out any remaining constructions */
      *end() {
        while (this.stack.length > 0)
          yield* this.pop();
      }
      get sourceToken() {
        const st = {
          type: this.type,
          offset: this.offset,
          indent: this.indent,
          source: this.source
        };
        return st;
      }
      *step() {
        const top = this.peek(1);
        if (this.type === "doc-end" && top?.type !== "doc-end") {
          while (this.stack.length > 0)
            yield* this.pop();
          this.stack.push({
            type: "doc-end",
            offset: this.offset,
            source: this.source
          });
          return;
        }
        if (!top)
          return yield* this.stream();
        switch (top.type) {
          case "document":
            return yield* this.document(top);
          case "alias":
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar":
            return yield* this.scalar(top);
          case "block-scalar":
            return yield* this.blockScalar(top);
          case "block-map":
            return yield* this.blockMap(top);
          case "block-seq":
            return yield* this.blockSequence(top);
          case "flow-collection":
            return yield* this.flowCollection(top);
          case "doc-end":
            return yield* this.documentEnd(top);
        }
        yield* this.pop();
      }
      peek(n) {
        return this.stack[this.stack.length - n];
      }
      *pop(error) {
        const token = error ?? this.stack.pop();
        if (!token) {
          const message = "Tried to pop an empty stack";
          yield { type: "error", offset: this.offset, source: "", message };
        } else if (this.stack.length === 0) {
          yield token;
        } else {
          const top = this.peek(1);
          if (token.type === "block-scalar") {
            token.indent = "indent" in top ? top.indent : 0;
          } else if (token.type === "flow-collection" && top.type === "document") {
            token.indent = 0;
          }
          if (token.type === "flow-collection")
            fixFlowSeqItems(token);
          switch (top.type) {
            case "document":
              top.value = token;
              break;
            case "block-scalar":
              top.props.push(token);
              break;
            case "block-map": {
              const it = top.items[top.items.length - 1];
              if (it.value) {
                top.items.push({ start: [], key: token, sep: [] });
                this.onKeyLine = true;
                return;
              } else if (it.sep) {
                it.value = token;
              } else {
                Object.assign(it, { key: token, sep: [] });
                this.onKeyLine = !it.explicitKey;
                return;
              }
              break;
            }
            case "block-seq": {
              const it = top.items[top.items.length - 1];
              if (it.value)
                top.items.push({ start: [], value: token });
              else
                it.value = token;
              break;
            }
            case "flow-collection": {
              const it = top.items[top.items.length - 1];
              if (!it || it.value)
                top.items.push({ start: [], key: token, sep: [] });
              else if (it.sep)
                it.value = token;
              else
                Object.assign(it, { key: token, sep: [] });
              return;
            }
            /* istanbul ignore next should not happen */
            default:
              yield* this.pop();
              yield* this.pop(token);
          }
          if ((top.type === "document" || top.type === "block-map" || top.type === "block-seq") && (token.type === "block-map" || token.type === "block-seq")) {
            const last = token.items[token.items.length - 1];
            if (last && !last.sep && !last.value && last.start.length > 0 && findNonEmptyIndex(last.start) === -1 && (token.indent === 0 || last.start.every((st) => st.type !== "comment" || st.indent < token.indent))) {
              if (top.type === "document")
                top.end = last.start;
              else
                top.items.push({ start: last.start });
              token.items.splice(-1, 1);
            }
          }
        }
      }
      *stream() {
        switch (this.type) {
          case "directive-line":
            yield { type: "directive", offset: this.offset, source: this.source };
            return;
          case "byte-order-mark":
          case "space":
          case "comment":
          case "newline":
            yield this.sourceToken;
            return;
          case "doc-mode":
          case "doc-start": {
            const doc = {
              type: "document",
              offset: this.offset,
              start: []
            };
            if (this.type === "doc-start")
              doc.start.push(this.sourceToken);
            this.stack.push(doc);
            return;
          }
        }
        yield {
          type: "error",
          offset: this.offset,
          message: `Unexpected ${this.type} token in YAML stream`,
          source: this.source
        };
      }
      *document(doc) {
        if (doc.value)
          return yield* this.lineEnd(doc);
        switch (this.type) {
          case "doc-start": {
            if (findNonEmptyIndex(doc.start) !== -1) {
              yield* this.pop();
              yield* this.step();
            } else
              doc.start.push(this.sourceToken);
            return;
          }
          case "anchor":
          case "tag":
          case "space":
          case "comment":
          case "newline":
            doc.start.push(this.sourceToken);
            return;
        }
        const bv = this.startBlockValue(doc);
        if (bv)
          this.stack.push(bv);
        else {
          yield {
            type: "error",
            offset: this.offset,
            message: `Unexpected ${this.type} token in YAML document`,
            source: this.source
          };
        }
      }
      *scalar(scalar) {
        if (this.type === "map-value-ind") {
          const prev = getPrevProps(this.peek(2));
          const start = getFirstKeyStartProps(prev);
          let sep;
          if (scalar.end) {
            sep = scalar.end;
            sep.push(this.sourceToken);
            delete scalar.end;
          } else
            sep = [this.sourceToken];
          const map = {
            type: "block-map",
            offset: scalar.offset,
            indent: scalar.indent,
            items: [{ start, key: scalar, sep }]
          };
          this.onKeyLine = true;
          this.stack[this.stack.length - 1] = map;
        } else
          yield* this.lineEnd(scalar);
      }
      *blockScalar(scalar) {
        switch (this.type) {
          case "space":
          case "comment":
          case "newline":
            scalar.props.push(this.sourceToken);
            return;
          case "scalar":
            scalar.source = this.source;
            this.atNewLine = true;
            this.indent = 0;
            if (this.onNewLine) {
              let nl = this.source.indexOf("\n") + 1;
              while (nl !== 0) {
                this.onNewLine(this.offset + nl);
                nl = this.source.indexOf("\n", nl) + 1;
              }
            }
            yield* this.pop();
            break;
          /* istanbul ignore next should not happen */
          default:
            yield* this.pop();
            yield* this.step();
        }
      }
      *blockMap(map) {
        const it = map.items[map.items.length - 1];
        switch (this.type) {
          case "newline":
            this.onKeyLine = false;
            if (it.value) {
              const end = "end" in it.value ? it.value.end : void 0;
              const last = Array.isArray(end) ? end[end.length - 1] : void 0;
              if (last?.type === "comment")
                end?.push(this.sourceToken);
              else
                map.items.push({ start: [this.sourceToken] });
            } else if (it.sep) {
              it.sep.push(this.sourceToken);
            } else {
              it.start.push(this.sourceToken);
            }
            return;
          case "space":
          case "comment":
            if (it.value) {
              map.items.push({ start: [this.sourceToken] });
            } else if (it.sep) {
              it.sep.push(this.sourceToken);
            } else {
              if (this.atIndentedComment(it.start, map.indent)) {
                const prev = map.items[map.items.length - 2];
                const end = prev?.value?.end;
                if (Array.isArray(end)) {
                  arrayPushArray(end, it.start);
                  end.push(this.sourceToken);
                  map.items.pop();
                  return;
                }
              }
              it.start.push(this.sourceToken);
            }
            return;
        }
        if (this.indent >= map.indent) {
          const atMapIndent = !this.onKeyLine && this.indent === map.indent;
          const atNextItem = atMapIndent && (it.sep || it.explicitKey) && this.type !== "seq-item-ind";
          let start = [];
          if (atNextItem && it.sep && !it.value) {
            const nl = [];
            for (let i = 0; i < it.sep.length; ++i) {
              const st = it.sep[i];
              switch (st.type) {
                case "newline":
                  nl.push(i);
                  break;
                case "space":
                  break;
                case "comment":
                  if (st.indent > map.indent)
                    nl.length = 0;
                  break;
                default:
                  nl.length = 0;
              }
            }
            if (nl.length >= 2)
              start = it.sep.splice(nl[1]);
          }
          switch (this.type) {
            case "anchor":
            case "tag":
              if (atNextItem || it.value) {
                start.push(this.sourceToken);
                map.items.push({ start });
                this.onKeyLine = true;
              } else if (it.sep) {
                it.sep.push(this.sourceToken);
              } else {
                it.start.push(this.sourceToken);
              }
              return;
            case "explicit-key-ind":
              if (!it.sep && !it.explicitKey) {
                it.start.push(this.sourceToken);
                it.explicitKey = true;
              } else if (atNextItem || it.value) {
                start.push(this.sourceToken);
                map.items.push({ start, explicitKey: true });
              } else {
                this.stack.push({
                  type: "block-map",
                  offset: this.offset,
                  indent: this.indent,
                  items: [{ start: [this.sourceToken], explicitKey: true }]
                });
              }
              this.onKeyLine = true;
              return;
            case "map-value-ind":
              if (it.explicitKey) {
                if (!it.sep) {
                  if (includesToken(it.start, "newline")) {
                    Object.assign(it, { key: null, sep: [this.sourceToken] });
                  } else {
                    const start2 = getFirstKeyStartProps(it.start);
                    this.stack.push({
                      type: "block-map",
                      offset: this.offset,
                      indent: this.indent,
                      items: [{ start: start2, key: null, sep: [this.sourceToken] }]
                    });
                  }
                } else if (it.value) {
                  map.items.push({ start: [], key: null, sep: [this.sourceToken] });
                } else if (includesToken(it.sep, "map-value-ind")) {
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start, key: null, sep: [this.sourceToken] }]
                  });
                } else if (isFlowToken(it.key) && !includesToken(it.sep, "newline")) {
                  const start2 = getFirstKeyStartProps(it.start);
                  const key = it.key;
                  const sep = it.sep;
                  sep.push(this.sourceToken);
                  delete it.key;
                  delete it.sep;
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start: start2, key, sep }]
                  });
                } else if (start.length > 0) {
                  it.sep = it.sep.concat(start, this.sourceToken);
                } else {
                  it.sep.push(this.sourceToken);
                }
              } else {
                if (!it.sep) {
                  Object.assign(it, { key: null, sep: [this.sourceToken] });
                } else if (it.value || atNextItem) {
                  map.items.push({ start, key: null, sep: [this.sourceToken] });
                } else if (includesToken(it.sep, "map-value-ind")) {
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start: [], key: null, sep: [this.sourceToken] }]
                  });
                } else {
                  it.sep.push(this.sourceToken);
                }
              }
              this.onKeyLine = true;
              return;
            case "alias":
            case "scalar":
            case "single-quoted-scalar":
            case "double-quoted-scalar": {
              const fs = this.flowScalar(this.type);
              if (atNextItem || it.value) {
                map.items.push({ start, key: fs, sep: [] });
                this.onKeyLine = true;
              } else if (it.sep) {
                this.stack.push(fs);
              } else {
                Object.assign(it, { key: fs, sep: [] });
                this.onKeyLine = true;
              }
              return;
            }
            default: {
              const bv = this.startBlockValue(map);
              if (bv) {
                if (bv.type === "block-seq") {
                  if (!it.explicitKey && it.sep && !includesToken(it.sep, "newline")) {
                    yield* this.pop({
                      type: "error",
                      offset: this.offset,
                      message: "Unexpected block-seq-ind on same line with key",
                      source: this.source
                    });
                    return;
                  }
                } else if (atMapIndent) {
                  map.items.push({ start });
                }
                this.stack.push(bv);
                return;
              }
            }
          }
        }
        yield* this.pop();
        yield* this.step();
      }
      *blockSequence(seq) {
        const it = seq.items[seq.items.length - 1];
        switch (this.type) {
          case "newline":
            if (it.value) {
              const end = "end" in it.value ? it.value.end : void 0;
              const last = Array.isArray(end) ? end[end.length - 1] : void 0;
              if (last?.type === "comment")
                end?.push(this.sourceToken);
              else
                seq.items.push({ start: [this.sourceToken] });
            } else
              it.start.push(this.sourceToken);
            return;
          case "space":
          case "comment":
            if (it.value)
              seq.items.push({ start: [this.sourceToken] });
            else {
              if (this.atIndentedComment(it.start, seq.indent)) {
                const prev = seq.items[seq.items.length - 2];
                const end = prev?.value?.end;
                if (Array.isArray(end)) {
                  arrayPushArray(end, it.start);
                  end.push(this.sourceToken);
                  seq.items.pop();
                  return;
                }
              }
              it.start.push(this.sourceToken);
            }
            return;
          case "anchor":
          case "tag":
            if (it.value || this.indent <= seq.indent)
              break;
            it.start.push(this.sourceToken);
            return;
          case "seq-item-ind":
            if (this.indent !== seq.indent)
              break;
            if (it.value || includesToken(it.start, "seq-item-ind"))
              seq.items.push({ start: [this.sourceToken] });
            else
              it.start.push(this.sourceToken);
            return;
        }
        if (this.indent > seq.indent) {
          const bv = this.startBlockValue(seq);
          if (bv) {
            this.stack.push(bv);
            return;
          }
        }
        yield* this.pop();
        yield* this.step();
      }
      *flowCollection(fc) {
        const it = fc.items[fc.items.length - 1];
        if (this.type === "flow-error-end") {
          let top;
          do {
            yield* this.pop();
            top = this.peek(1);
          } while (top?.type === "flow-collection");
        } else if (fc.end.length === 0) {
          switch (this.type) {
            case "comma":
            case "explicit-key-ind":
              if (!it || it.sep)
                fc.items.push({ start: [this.sourceToken] });
              else
                it.start.push(this.sourceToken);
              return;
            case "map-value-ind":
              if (!it || it.value)
                fc.items.push({ start: [], key: null, sep: [this.sourceToken] });
              else if (it.sep)
                it.sep.push(this.sourceToken);
              else
                Object.assign(it, { key: null, sep: [this.sourceToken] });
              return;
            case "space":
            case "comment":
            case "newline":
            case "anchor":
            case "tag":
              if (!it || it.value)
                fc.items.push({ start: [this.sourceToken] });
              else if (it.sep)
                it.sep.push(this.sourceToken);
              else
                it.start.push(this.sourceToken);
              return;
            case "alias":
            case "scalar":
            case "single-quoted-scalar":
            case "double-quoted-scalar": {
              const fs = this.flowScalar(this.type);
              if (!it || it.value)
                fc.items.push({ start: [], key: fs, sep: [] });
              else if (it.sep)
                this.stack.push(fs);
              else
                Object.assign(it, { key: fs, sep: [] });
              return;
            }
            case "flow-map-end":
            case "flow-seq-end":
              fc.end.push(this.sourceToken);
              return;
          }
          const bv = this.startBlockValue(fc);
          if (bv)
            this.stack.push(bv);
          else {
            yield* this.pop();
            yield* this.step();
          }
        } else {
          const parent = this.peek(2);
          if (parent.type === "block-map" && (this.type === "map-value-ind" && parent.indent === fc.indent || this.type === "newline" && !parent.items[parent.items.length - 1].sep)) {
            yield* this.pop();
            yield* this.step();
          } else if (this.type === "map-value-ind" && parent.type !== "flow-collection") {
            const prev = getPrevProps(parent);
            const start = getFirstKeyStartProps(prev);
            fixFlowSeqItems(fc);
            const sep = fc.end.splice(1, fc.end.length);
            sep.push(this.sourceToken);
            const map = {
              type: "block-map",
              offset: fc.offset,
              indent: fc.indent,
              items: [{ start, key: fc, sep }]
            };
            this.onKeyLine = true;
            this.stack[this.stack.length - 1] = map;
          } else {
            yield* this.lineEnd(fc);
          }
        }
      }
      flowScalar(type) {
        if (this.onNewLine) {
          let nl = this.source.indexOf("\n") + 1;
          while (nl !== 0) {
            this.onNewLine(this.offset + nl);
            nl = this.source.indexOf("\n", nl) + 1;
          }
        }
        return {
          type,
          offset: this.offset,
          indent: this.indent,
          source: this.source
        };
      }
      startBlockValue(parent) {
        switch (this.type) {
          case "alias":
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar":
            return this.flowScalar(this.type);
          case "block-scalar-header":
            return {
              type: "block-scalar",
              offset: this.offset,
              indent: this.indent,
              props: [this.sourceToken],
              source: ""
            };
          case "flow-map-start":
          case "flow-seq-start":
            return {
              type: "flow-collection",
              offset: this.offset,
              indent: this.indent,
              start: this.sourceToken,
              items: [],
              end: []
            };
          case "seq-item-ind":
            return {
              type: "block-seq",
              offset: this.offset,
              indent: this.indent,
              items: [{ start: [this.sourceToken] }]
            };
          case "explicit-key-ind": {
            this.onKeyLine = true;
            const prev = getPrevProps(parent);
            const start = getFirstKeyStartProps(prev);
            start.push(this.sourceToken);
            return {
              type: "block-map",
              offset: this.offset,
              indent: this.indent,
              items: [{ start, explicitKey: true }]
            };
          }
          case "map-value-ind": {
            this.onKeyLine = true;
            const prev = getPrevProps(parent);
            const start = getFirstKeyStartProps(prev);
            return {
              type: "block-map",
              offset: this.offset,
              indent: this.indent,
              items: [{ start, key: null, sep: [this.sourceToken] }]
            };
          }
        }
        return null;
      }
      atIndentedComment(start, indent) {
        if (this.type !== "comment")
          return false;
        if (this.indent <= indent)
          return false;
        return start.every((st) => st.type === "newline" || st.type === "space");
      }
      *documentEnd(docEnd) {
        if (this.type !== "doc-mode") {
          if (docEnd.end)
            docEnd.end.push(this.sourceToken);
          else
            docEnd.end = [this.sourceToken];
          if (this.type === "newline")
            yield* this.pop();
        }
      }
      *lineEnd(token) {
        switch (this.type) {
          case "comma":
          case "doc-start":
          case "doc-end":
          case "flow-seq-end":
          case "flow-map-end":
          case "map-value-ind":
            yield* this.pop();
            yield* this.step();
            break;
          case "newline":
            this.onKeyLine = false;
          // fallthrough
          case "space":
          case "comment":
          default:
            if (token.end)
              token.end.push(this.sourceToken);
            else
              token.end = [this.sourceToken];
            if (this.type === "newline")
              yield* this.pop();
        }
      }
    };
    exports2.Parser = Parser;
  }
});

// node_modules/yaml/dist/public-api.js
var require_public_api = __commonJS({
  "node_modules/yaml/dist/public-api.js"(exports2) {
    "use strict";
    var composer = require_composer();
    var Document = require_Document();
    var errors = require_errors();
    var log = require_log();
    var identity = require_identity();
    var lineCounter = require_line_counter();
    var parser = require_parser();
    function parseOptions(options) {
      const prettyErrors = options.prettyErrors !== false;
      const lineCounter$1 = options.lineCounter || prettyErrors && new lineCounter.LineCounter() || null;
      return { lineCounter: lineCounter$1, prettyErrors };
    }
    function parseAllDocuments(source, options = {}) {
      const { lineCounter: lineCounter2, prettyErrors } = parseOptions(options);
      const parser$1 = new parser.Parser(lineCounter2?.addNewLine);
      const composer$1 = new composer.Composer(options);
      const docs = Array.from(composer$1.compose(parser$1.parse(source)));
      if (prettyErrors && lineCounter2)
        for (const doc of docs) {
          doc.errors.forEach(errors.prettifyError(source, lineCounter2));
          doc.warnings.forEach(errors.prettifyError(source, lineCounter2));
        }
      if (docs.length > 0)
        return docs;
      return Object.assign([], { empty: true }, composer$1.streamInfo());
    }
    function parseDocument2(source, options = {}) {
      const { lineCounter: lineCounter2, prettyErrors } = parseOptions(options);
      const parser$1 = new parser.Parser(lineCounter2?.addNewLine);
      const composer$1 = new composer.Composer(options);
      let doc = null;
      for (const _doc of composer$1.compose(parser$1.parse(source), true, source.length)) {
        if (!doc)
          doc = _doc;
        else if (doc.options.logLevel !== "silent") {
          doc.errors.push(new errors.YAMLParseError(_doc.range.slice(0, 2), "MULTIPLE_DOCS", "Source contains multiple documents; please use YAML.parseAllDocuments()"));
          break;
        }
      }
      if (prettyErrors && lineCounter2) {
        doc.errors.forEach(errors.prettifyError(source, lineCounter2));
        doc.warnings.forEach(errors.prettifyError(source, lineCounter2));
      }
      return doc;
    }
    function parse5(src, reviver, options) {
      let _reviver = void 0;
      if (typeof reviver === "function") {
        _reviver = reviver;
      } else if (options === void 0 && reviver && typeof reviver === "object") {
        options = reviver;
      }
      const doc = parseDocument2(src, options);
      if (!doc)
        return null;
      doc.warnings.forEach((warning) => log.warn(doc.options.logLevel, warning));
      if (doc.errors.length > 0) {
        if (doc.options.logLevel !== "silent")
          throw doc.errors[0];
        else
          doc.errors = [];
      }
      return doc.toJS(Object.assign({ reviver: _reviver }, options));
    }
    function stringify2(value, replacer, options) {
      let _replacer = null;
      if (typeof replacer === "function" || Array.isArray(replacer)) {
        _replacer = replacer;
      } else if (options === void 0 && replacer) {
        options = replacer;
      }
      if (typeof options === "string")
        options = options.length;
      if (typeof options === "number") {
        const indent = Math.round(options);
        options = indent < 1 ? void 0 : indent > 8 ? { indent: 8 } : { indent };
      }
      if (value === void 0) {
        const { keepUndefined } = options ?? replacer ?? {};
        if (!keepUndefined)
          return void 0;
      }
      if (identity.isDocument(value) && !_replacer)
        return value.toString(options);
      return new Document.Document(value, _replacer, options).toString(options);
    }
    exports2.parse = parse5;
    exports2.parseAllDocuments = parseAllDocuments;
    exports2.parseDocument = parseDocument2;
    exports2.stringify = stringify2;
  }
});

// node_modules/yaml/dist/index.js
var require_dist = __commonJS({
  "node_modules/yaml/dist/index.js"(exports2) {
    "use strict";
    var composer = require_composer();
    var Document = require_Document();
    var Schema2 = require_Schema();
    var errors = require_errors();
    var Alias = require_Alias();
    var identity = require_identity();
    var Pair = require_Pair();
    var Scalar = require_Scalar();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var cst = require_cst();
    var lexer = require_lexer();
    var lineCounter = require_line_counter();
    var parser = require_parser();
    var publicApi = require_public_api();
    var visit = require_visit();
    exports2.Composer = composer.Composer;
    exports2.Document = Document.Document;
    exports2.Schema = Schema2.Schema;
    exports2.YAMLError = errors.YAMLError;
    exports2.YAMLParseError = errors.YAMLParseError;
    exports2.YAMLWarning = errors.YAMLWarning;
    exports2.Alias = Alias.Alias;
    exports2.isAlias = identity.isAlias;
    exports2.isCollection = identity.isCollection;
    exports2.isDocument = identity.isDocument;
    exports2.isMap = identity.isMap;
    exports2.isNode = identity.isNode;
    exports2.isPair = identity.isPair;
    exports2.isScalar = identity.isScalar;
    exports2.isSeq = identity.isSeq;
    exports2.Pair = Pair.Pair;
    exports2.Scalar = Scalar.Scalar;
    exports2.YAMLMap = YAMLMap.YAMLMap;
    exports2.YAMLSeq = YAMLSeq.YAMLSeq;
    exports2.CST = cst;
    exports2.Lexer = lexer.Lexer;
    exports2.LineCounter = lineCounter.LineCounter;
    exports2.Parser = parser.Parser;
    exports2.parse = publicApi.parse;
    exports2.parseAllDocuments = publicApi.parseAllDocuments;
    exports2.parseDocument = publicApi.parseDocument;
    exports2.stringify = publicApi.stringify;
    exports2.visit = visit.visit;
    exports2.visitAsync = visit.visitAsync;
  }
});

// src/forge/cli/main.ts
var import_node_fs16 = require("node:fs");

// src/forge/cli/run.ts
var import_node_child_process2 = require("node:child_process");
var import_node_fs15 = require("node:fs");
var import_node_os = require("node:os");
var import_node_path16 = __toESM(require("node:path"), 1);

// src/forge/ledger.ts
var import_node_fs = require("node:fs");
var import_node_path = __toESM(require("node:path"), 1);

// src/lib/forge-status.ts
var CLIP = 80;
var MAX_VALIDATORS = 10;
var MAX_ACCEPTED = 200;
var MAX_STAGES = 20;
var MAX_TS = 40;
var isoMs = (s2) => s2 !== null && /^\d{4}-\d{2}-\d{2}T/.test(s2) ? Date.parse(s2) : NaN;
var tsText = (x) => str(x) && x.length <= MAX_TS ? x : null;
var stageKey = (phase) => phase ? phase.toLowerCase() : "triage";
function closeStage(s2, ts) {
  const from = isoMs(s2.stageSince);
  const to = isoMs(ts);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return s2.stages;
  const key = stageKey(s2.phase);
  if (!(key in s2.stages) && Object.keys(s2.stages).length >= MAX_STAGES) return s2.stages;
  return { ...s2.stages, [key]: (s2.stages[key] ?? 0) + Math.round((to - from) / 1e3) };
}
function stagesOf(x) {
  const out = {};
  if (!isObj(x)) return out;
  for (const [k, v] of Object.entries(x)) {
    if (Object.keys(out).length >= MAX_STAGES) break;
    const key = cleanText(k).toLowerCase();
    if (!key || typeof v !== "number" || !Number.isFinite(v) || v < 0) continue;
    out[key] = Math.round(v);
  }
  return out;
}
var str = (x) => typeof x === "string";
var num = (x) => typeof x === "number" && Number.isFinite(x) ? x : null;
var isObj = (x) => !!x && typeof x === "object" && !Array.isArray(x);
var cleanText = (s2) => s2.replace(/[\x00-\x1f\x7f-\x9f‪-‮⁦-⁩]/g, "").slice(0, CLIP);
var EMPTY_VERIFY = { planned: false, surfaces: [], result: null, passed: null, total: null, evidence: null, reason: null };
var pathText = (x) => str(x) ? x.replace(/[\x00-\x1f\x7f-\x9f]/g, "").slice(0, 200) : null;
var briefOf = (task, t) => str(t) && t.startsWith(`${task}-`) && /^\d+$/.test(t.slice(task.length + 1)) ? Number(t.slice(task.length + 1)) : null;
var briefNum = (x) => typeof x === "number" && Number.isInteger(x) && x > 0 && x < 1e4 ? x : null;
var ownedBy = (task, t) => str(t) && (t === task || t.startsWith(`${task}-`) && /^\d+$/.test(t.slice(task.length + 1)));
var validatorsOf = (results) => (Array.isArray(results) ? results : []).filter((r2) => isObj(r2) && str(r2.validator)).slice(0, MAX_VALIDATORS).map((r2) => ({ name: cleanText(r2.validator), ok: r2.ok === true }));
function deriveStatus(prev, event) {
  if (!isObj(event) || !str(event.ts) || !str(event.kind)) return prev;
  const e = event;
  const ts = event.ts;
  if ((e.kind === "triage" || e.kind === "phase") && str(e.task) && e.task) {
    const task = cleanText(e.task);
    const fresh = e.kind === "triage" && Array.isArray(e.reasons);
    const same = !!prev && prev.task === task && !fresh;
    const base = same ? prev : {
      ts,
      task,
      path: "",
      phase: "",
      agent: null,
      validators: [],
      verdict: null,
      round: null,
      cap: null,
      brief: null,
      accepted: [],
      verify: null,
      taskStartedAt: ts,
      stageSince: ts,
      stages: {},
      doneAt: null
    };
    const next = { ...base, ts };
    if (e.kind === "triage" && str(e.path)) next.path = cleanText(e.path);
    if (e.kind === "phase" && str(e.phase)) {
      const phase = cleanText(e.phase);
      const done = phase.toLowerCase() === "done";
      if (!(done && base.doneAt)) {
        if (same && !base.doneAt) next.stages = closeStage(base, ts);
        next.stageSince = ts;
        next.doneAt = done ? ts : null;
      }
      next.phase = phase;
    }
    if (e.kind === "phase" && briefNum(e.brief) !== null) next.brief = briefNum(e.brief);
    return next;
  }
  if (!prev || !ownedBy(prev.task, e.task)) return prev;
  const n = briefOf(prev.task, e.task);
  const cur = n !== null ? { ...prev, brief: n } : prev;
  switch (e.kind) {
    case "agent":
      return str(e.agent) ? { ...prev, agent: cleanText(e.agent) } : prev;
    case "validate":
      return { ...cur, validators: validatorsOf(e.results) };
    case "verdict": {
      if (!str(e.action)) return prev;
      const accepted = n !== null && e.action === "accept" && !cur.accepted.includes(n) ? [...cur.accepted, n].sort((a, b) => a - b).slice(-MAX_ACCEPTED) : cur.accepted;
      const verdict = { action: cleanText(e.action), score: num(e.score) };
      if (n === null && e.action === "accept" && !cur.doneAt) {
        return { ...cur, accepted, verdict, stages: closeStage(cur, ts), stageSince: ts, doneAt: ts };
      }
      return { ...cur, accepted, verdict };
    }
    case "round":
      return { ...cur, round: num(e.round), cap: num(e.cap) };
    case "verify": {
      const v = { ...cur.verify ?? EMPTY_VERIFY };
      if (typeof e.planned === "boolean") {
        v.planned = e.planned;
        v.surfaces = (Array.isArray(e.surfaces) ? e.surfaces : []).filter(str).slice(0, MAX_VALIDATORS).map(cleanText);
        v.result = null;
        v.passed = null;
        v.total = null;
        v.evidence = null;
        v.reason = null;
      }
      if (str(e.result)) {
        v.result = cleanText(e.result);
        v.passed = num(e.passed);
        v.total = num(e.total);
        v.evidence = pathText(e.evidence);
        v.reason = str(e.reason) ? cleanText(e.reason) : null;
      }
      return { ...cur, verify: v };
    }
    default:
      return prev;
  }
}
function normalizeStatus(x) {
  if (!isObj(x) || !str(x.ts) || !str(x.task) || !x.task || !str(x.path) || !str(x.phase)) return null;
  if (x.agent !== null && !str(x.agent)) return null;
  if (!Array.isArray(x.validators)) return null;
  let verdict = null;
  if (x.verdict !== null) {
    if (!isObj(x.verdict) || !str(x.verdict.action)) return null;
    verdict = { action: cleanText(x.verdict.action), score: num(x.verdict.score) };
  }
  return {
    ts: x.ts,
    task: cleanText(x.task),
    path: cleanText(x.path),
    phase: cleanText(x.phase),
    agent: str(x.agent) ? cleanText(x.agent) : null,
    validators: x.validators.filter((v) => isObj(v) && str(v.name)).slice(0, MAX_VALIDATORS).map((v) => ({ name: cleanText(v.name), ok: v.ok === true })),
    verdict,
    round: num(x.round),
    cap: num(x.cap),
    // Absent in a status written before these fields existed.
    brief: briefNum(x.brief),
    accepted: Array.isArray(x.accepted) ? [...new Set(x.accepted.map(briefNum).filter((v) => v !== null))].sort((a, b) => a - b).slice(-MAX_ACCEPTED) : [],
    // Absent in a status written before the verify plan existed.
    verify: isObj(x.verify) && typeof x.verify.planned === "boolean" ? {
      planned: x.verify.planned,
      surfaces: (Array.isArray(x.verify.surfaces) ? x.verify.surfaces : []).filter(str).slice(0, MAX_VALIDATORS).map(cleanText),
      result: str(x.verify.result) ? cleanText(x.verify.result) : null,
      passed: num(x.verify.passed),
      total: num(x.verify.total),
      evidence: pathText(x.verify.evidence),
      reason: str(x.verify.reason) ? cleanText(x.verify.reason) : null
    } : null,
    // Absent in a status written before timings existed: no times are shown.
    taskStartedAt: tsText(x.taskStartedAt),
    stageSince: tsText(x.stageSince),
    stages: stagesOf(x.stages),
    doneAt: tsText(x.doneAt)
  };
}

// src/forge/ledger.ts
var LEDGER_KINDS = ["triage", "phase", "agent", "validate", "verdict", "round", "ruling", "cycle", "proposal", "verify", "verify-skip", "decision"];
var GITIGNORE = "*\n!.gitignore\n!config.yaml\n!verify/\n!verify/*.md\n";
var GITIGNORE_05 = "*\n!.gitignore\n!config.yaml\n";
var forgePath = (root) => import_node_path.default.join(root, ".forge");
var ledgerFile = (root) => import_node_path.default.join(forgePath(root), "ledger.jsonl");
var statusFile = (root) => import_node_path.default.join(forgePath(root), "status.json");
function forgeDir(root) {
  const dir = forgePath(root);
  (0, import_node_fs.mkdirSync)(dir, { recursive: true });
  const ignore = import_node_path.default.join(dir, ".gitignore");
  if (!(0, import_node_fs.existsSync)(ignore)) (0, import_node_fs.writeFileSync)(ignore, GITIGNORE);
  else {
    try {
      if ((0, import_node_fs.readFileSync)(ignore, "utf8").replace(/\r\n/g, "\n") === GITIGNORE_05) (0, import_node_fs.writeFileSync)(ignore, GITIGNORE);
    } catch {
    }
  }
  return dir;
}
function endsMidLine(file) {
  if (!(0, import_node_fs.existsSync)(file)) return false;
  const fd = (0, import_node_fs.openSync)(file, "r");
  try {
    const size = (0, import_node_fs.fstatSync)(fd).size;
    if (!size) return false;
    const buf = Buffer.alloc(1);
    return (0, import_node_fs.readSync)(fd, buf, 0, 1, size - 1) === 1 && buf[0] !== 10;
  } finally {
    (0, import_node_fs.closeSync)(fd);
  }
}
function appendEvent(root, event) {
  forgeDir(root);
  const file = ledgerFile(root);
  (0, import_node_fs.appendFileSync)(file, (endsMidLine(file) ? "\n" : "") + JSON.stringify(event) + "\n");
  updateStatus(root, event);
}
function updateStatus(root, event) {
  try {
    const file = statusFile(root);
    let prev = null;
    try {
      prev = normalizeStatus(JSON.parse((0, import_node_fs.readFileSync)(file, "utf8")));
    } catch {
    }
    const next = deriveStatus(prev, event);
    if (!next || next === prev) return;
    const tmp = `${file}.${process.pid}.tmp`;
    (0, import_node_fs.writeFileSync)(tmp, JSON.stringify(next) + "\n");
    (0, import_node_fs.renameSync)(tmp, file);
  } catch {
  }
}
function readEvents(root) {
  const file = ledgerFile(root);
  if (!(0, import_node_fs.existsSync)(file)) return [];
  const out = [];
  for (const line of (0, import_node_fs.readFileSync)(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (e && typeof e === "object" && typeof e.ts === "string" && LEDGER_KINDS.includes(e.kind) && (e.task === void 0 || typeof e.task === "string")) out.push(e);
    } catch {
    }
  }
  return out;
}

// src/forge/run.ts
var import_node_fs2 = require("node:fs");
var import_node_path2 = __toESM(require("node:path"), 1);

// src/lib/forge-run.ts
var isCount = (x) => typeof x === "number" && Number.isInteger(x) && x >= 0;
var isPositiveInt = (x) => isCount(x) && x > 0;
var isPositive = (x) => typeof x === "number" && Number.isFinite(x) && x > 0;
function parseRun(text) {
  if (text === null) return null;
  let o;
  try {
    const x = JSON.parse(text);
    if (!x || typeof x !== "object" || Array.isArray(x)) return null;
    o = x;
  } catch {
    return null;
  }
  if (o.mode !== "infinite" || typeof o.active !== "boolean" || typeof o.repeatedError !== "boolean") return null;
  if (typeof o.startedAt !== "string" || Number.isNaN(Date.parse(o.startedAt))) return null;
  if (!isCount(o.cycle) || !isCount(o.noProgress) || !isPositiveInt(o.queueMax)) return null;
  if (o.lastError !== null && typeof o.lastError !== "string") return null;
  if (o.lastBlockEvents !== null && !isCount(o.lastBlockEvents)) return null;
  if (o.stoppedReason !== void 0 && typeof o.stoppedReason !== "string") return null;
  if (o.sessionId !== null && (typeof o.sessionId !== "string" || !o.sessionId)) return null;
  if (o.blocksSinceCycle !== void 0 && !isCount(o.blocksSinceCycle)) return null;
  const b = o.budget;
  if (!b || typeof b !== "object" || Array.isArray(b)) return null;
  const { cycles, hours } = b;
  if (cycles !== void 0 && !isPositiveInt(cycles)) return null;
  if (hours !== void 0 && !isPositive(hours)) return null;
  const run2 = {
    mode: "infinite",
    active: o.active,
    startedAt: o.startedAt,
    budget: { ...cycles !== void 0 ? { cycles } : {}, ...hours !== void 0 ? { hours } : {} },
    cycle: o.cycle,
    noProgress: o.noProgress,
    lastError: o.lastError,
    repeatedError: o.repeatedError,
    lastBlockEvents: o.lastBlockEvents,
    queueMax: o.queueMax,
    sessionId: o.sessionId,
    blocksSinceCycle: o.blocksSinceCycle ?? 0
  };
  if (o.stoppedReason !== void 0) run2.stoppedReason = o.stoppedReason;
  return run2;
}

// src/forge/run.ts
var DEFAULT_QUEUE_MAX = 10;
var NO_PROGRESS_LIMIT = 3;
var NO_CYCLE_BLOCKS = 2;
var MAX_ERROR = 2e3;
function startRun(now, budget, queueMax = DEFAULT_QUEUE_MAX, sessionId = null) {
  return {
    mode: "infinite",
    active: true,
    startedAt: now.toISOString(),
    budget: { ...budget.cycles !== void 0 ? { cycles: budget.cycles } : {}, ...budget.hours !== void 0 ? { hours: budget.hours } : {} },
    cycle: 0,
    noProgress: 0,
    lastError: null,
    repeatedError: false,
    lastBlockEvents: null,
    queueMax,
    sessionId,
    blocksSinceCycle: 0
  };
}
function recordCycle(run2, result) {
  const error = result.error?.trim().slice(0, MAX_ERROR) || null;
  return {
    ...run2,
    cycle: run2.cycle + 1,
    noProgress: result.progress ? 0 : run2.noProgress + 1,
    lastError: error,
    repeatedError: error !== null && error === run2.lastError,
    blocksSinceCycle: 0
  };
}
function stopReason(run2, ctx) {
  if (ctx.stopFile) return "stop-file";
  if (run2.budget.cycles !== void 0 && run2.cycle >= run2.budget.cycles) return "budget-cycles";
  if (run2.budget.hours !== void 0 && ctx.now.getTime() - Date.parse(run2.startedAt) >= run2.budget.hours * 36e5) return "budget-hours";
  if (run2.noProgress >= NO_PROGRESS_LIMIT) return "no-progress";
  if (run2.repeatedError) return "repeated-error";
  if (run2.blocksSinceCycle >= NO_CYCLE_BLOCKS) return "no-cycle";
  if (ctx.approvedPending === 0 && ctx.pendingProposals >= run2.queueMax) return "queue-full";
  return null;
}
var endRun = (run2, reason) => ({ ...run2, active: false, stoppedReason: reason });
var runFile = (root) => import_node_path2.default.join(root, ".forge", "run.json");
var stopFile = (root) => import_node_path2.default.join(root, ".forge", "stop");
function readRunText(root) {
  const file = runFile(root);
  if (!(0, import_node_fs2.existsSync)(file)) return null;
  try {
    return (0, import_node_fs2.readFileSync)(file, "utf8");
  } catch {
    return null;
  }
}
function saveRun(root, run2) {
  forgeDir(root);
  const file = runFile(root);
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    (0, import_node_fs2.writeFileSync)(tmp, JSON.stringify(run2, null, 2) + "\n");
    (0, import_node_fs2.renameSync)(tmp, file);
  } finally {
    (0, import_node_fs2.rmSync)(tmp, { force: true });
  }
}

// src/lib/deps.ts
var statusOf = (states, id2) => states[id2]?.status ?? "free";
function isUnlocked(task, states) {
  return task.depends_on.every((d) => statusOf(states, d) === "done");
}
function isAvailable(task, states) {
  const st = states[task.id];
  const status = statusOf(states, task.id);
  if (status === "free") return true;
  if (status !== "blocked") return false;
  const by = st?.blockedBy ?? [];
  return by.length > 0 && !by.includes("external") && by.every((b) => statusOf(states, b) === "done");
}
var commitShas = (states, id2) => (Array.isArray(states[id2]?.commits) ? states[id2].commits : []).map((c) => c?.sha).filter((s2) => typeof s2 === "string" && !!s2);

// src/lib/zones.ts
var WILD = /[*?[{]/;
var norm = (p) => p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
function staticPrefix(glob) {
  const out = [];
  for (const part of norm(glob).split("/")) {
    if (WILD.test(part)) break;
    out.push(part);
  }
  return out.join("/");
}
var under = (a, b) => b === "" || a === b || a.startsWith(`${b}/`);
function globsOverlap(a, b) {
  const wa = WILD.test(a);
  const wb = WILD.test(b);
  if (!wa && !wb) {
    const na = norm(a);
    const nb = norm(b);
    return under(na, nb) || under(nb, na);
  }
  if (wa && wb) {
    const pa = staticPrefix(a);
    const pb = staticPrefix(b);
    return under(pa, pb) || under(pb, pa);
  }
  const literal = norm(wa ? b : a);
  const prefix = staticPrefix(wa ? a : b);
  return under(literal, prefix) || under(prefix, literal);
}
function overlappingZones(a, b) {
  const out = [];
  for (const x of a) for (const y of b) if (globsOverlap(x, y)) out.push([x, y]);
  return out;
}

// src/lib/coordination.ts
var IDLE_MINUTES = 15;
var LEASE_CAP_MINUTES = 90;
var LEASE_MINUTES = 10;
var SILENT_MINUTES = 5;
function zonesOf(task, state) {
  const touched = Array.isArray(state?.zonesTouched) ? state.zonesTouched : [];
  return [...task.zones, ...touched].filter((z) => typeof z === "string");
}
function liveness(now, leaseUntil) {
  const until = typeof leaseUntil === "string" ? Date.parse(leaseUntil) : NaN;
  if (!Number.isFinite(until)) return "stopped";
  if (now < until) return "alive";
  return now - until < SILENT_MINUTES * 6e4 ? "silent" : "stopped";
}
function sessionLiveness(s2, now) {
  if (!s2 || s2.status === "idle") return "stopped";
  if (typeof s2.leaseUntil === "string") return liveness(now, s2.leaseUntil);
  return legacyIdle(s2, now) ? "stopped" : "alive";
}
function legacyIdle(s2, now, minutes = IDLE_MINUTES) {
  if (!s2 || s2.status === "idle") return true;
  const hb = Date.parse(s2.heartbeatAt);
  if (!Number.isFinite(hb)) return true;
  const lease = typeof s2.busyUntil === "string" ? Date.parse(s2.busyUntil) : NaN;
  if (Number.isFinite(lease) && lease - hb <= LEASE_CAP_MINUTES * 6e4 && now < lease) return false;
  return now - hb > minutes * 6e4;
}

// src/forge/hook.ts
var executionBlockReason = (running, parallel) => `forge execution is active (${running}/${parallel} running). Step it as /forge:run's Execution section describes; to end it run /forge:stop.`;
var executionEndedReason = (reason) => `the forge execution ended (${reason}): report it as /forge:run's Execution section says (step 7), then stop.`;
function bindHookSession(e, session) {
  if (!e || !e.active || e.hookSession !== null || typeof session !== "string" || !session) return e;
  return { ...e, hookSession: session };
}
function decideExecutionStop(input, exec, ctx) {
  if (!exec || !exec.active) return { block: false, exec };
  const session = typeof input.session_id === "string" && input.session_id ? input.session_id : null;
  if (exec.hookSession !== null && session !== exec.hookSession) return { block: false, exec };
  const e = bindHookSession(exec, session);
  const hookSession = e.hookSession;
  if (ctx.stopFile) {
    const ended = { ...e, active: false, stopReason: "stopped", sleepUntil: null, hookSession };
    return { block: true, reason: executionEndedReason("stopped"), ended: "stopped", exec: ended };
  }
  const now = ctx.now.getTime();
  const until = e.sleepUntil ? Date.parse(e.sleepUntil) : NaN;
  if (Number.isFinite(until) && until > now) return { block: false, exec: e };
  const agentRunning = Object.values(e.tasks).some((t) => t.status === "running" && !!t.agent && now - Date.parse(t.updatedAt) < LEASE_MINUTES * 6e4);
  if (agentRunning) return { block: false, exec: e };
  if (input.stop_hook_active === true && e.lastStepAt === e.lastBlockStep) return { block: false, exec: e };
  const running = Object.values(e.tasks).filter((t) => t.status === "running").length;
  return { block: true, reason: executionBlockReason(running, e.parallel), exec: { ...e, hookSession, lastBlockStep: e.lastStepAt } };
}
var hhmm = (d) => d.toISOString().slice(11, 16);
function blockReason(run2) {
  const parts = [];
  parts.push(run2.budget.cycles !== void 0 ? `cycle ${run2.cycle + 1} of ${run2.budget.cycles}` : `cycle ${run2.cycle + 1}`);
  if (run2.budget.hours !== void 0) parts.push(`until ${hhmm(new Date(Date.parse(run2.startedAt) + run2.budget.hours * 36e5))} UTC`);
  return `forge infinite mode is active (${parts.join(" / ")}). Run the next cycle as /forge:infinite describes; to end the run create .forge/stop or run /forge:stop.`;
}
var endedReason = (reason) => `the forge infinite run ended (${reason}): do step 4 of /forge:infinite (turn off meta/infinite and report), then stop.`;
function decideStop(input, run2, ctx) {
  if (!run2 || !run2.active) return { block: false, run: run2 };
  const session = typeof input.session_id === "string" && input.session_id ? input.session_id : null;
  if (run2.sessionId !== null && session !== run2.sessionId) return { block: false, run: run2 };
  if (ctx.swarmSleeping) return { block: false, run: run2 };
  const sessionId = run2.sessionId ?? session;
  const reason = stopReason(run2, ctx);
  if (reason) return { block: true, reason: endedReason(reason), ended: reason, run: { ...endRun(run2, reason), lastBlockEvents: ctx.ledgerEvents, sessionId } };
  if (input.stop_hook_active === true && ctx.ledgerEvents === run2.lastBlockEvents) return { block: false, run: run2 };
  return { block: true, reason: blockReason(run2), run: { ...run2, lastBlockEvents: ctx.ledgerEvents, sessionId, blocksSinceCycle: run2.blocksSinceCycle + 1 } };
}

// src/forge/execution.ts
var import_node_fs4 = require("node:fs");
var import_node_path4 = __toESM(require("node:path"), 1);

// src/forge/swarm.ts
var import_node_fs3 = require("node:fs");
var import_node_path3 = __toESM(require("node:path"), 1);

// src/lib/swarm-state.ts
var FRONT_STATUSES = ["running", "queued", "waiting", "blocked", "ready", "integrated", "conflict", "launch-failed"];
var STOP_REASONS = ["finished", "stalled", "stopped", "budget"];
var NOTICE_KINDS = ["main-dirty", "launch-failed", "conflict"];
var MAX_FRONTS = 200;
var isObj2 = (x) => !!x && typeof x === "object" && !Array.isArray(x);
var str2 = (x) => typeof x === "string" && x ? x : null;
var iso = (x) => typeof x === "string" && !Number.isNaN(Date.parse(x)) ? x : null;
var count = (x) => typeof x === "number" && Number.isInteger(x) && x >= 0 ? x : 0;
var oneOf = (list, x) => list.includes(x) ? x : null;
function normalizeFront(x) {
  if (!isObj2(x)) return null;
  const status = oneOf(FRONT_STATUSES, x.status);
  if (!status) return null;
  const w = isObj2(x.waitingFor) ? x.waitingFor : null;
  const reason = w ? oneOf(["not-done", "not-integrated"], w.reason) : null;
  return {
    status,
    session: str2(x.session),
    launchedAt: iso(x.launchedAt),
    currentTask: str2(x.currentTask),
    heartbeatAt: iso(x.heartbeatAt),
    done: count(x.done),
    total: count(x.total),
    waitingFor: w && reason && str2(w.task) && str2(w.track) ? { task: str2(w.task), track: str2(w.track), reason } : null,
    detail: str2(x.detail)
  };
}
function normalizeSwarm(x) {
  if (!isObj2(x)) return null;
  const { project, base, coordinator } = { project: str2(x.project), base: str2(x.base), coordinator: str2(x.coordinator) };
  const startedAt = iso(x.startedAt);
  const parallel = typeof x.parallel === "number" && Number.isInteger(x.parallel) && x.parallel >= 1 && x.parallel <= 10 ? x.parallel : null;
  if (!project || !base || !coordinator || !startedAt || parallel === null || typeof x.active !== "boolean") return null;
  const n = isObj2(x.notice) ? x.notice : null;
  const kind = n ? oneOf(NOTICE_KINDS, n.kind) : null;
  const fronts = {};
  if (isObj2(x.fronts)) {
    for (const [id2, f] of Object.entries(x.fronts).slice(0, MAX_FRONTS)) {
      const front = normalizeFront(f);
      if (front) fronts[id2] = front;
    }
  }
  return {
    active: x.active,
    parallel,
    mergeAuthorized: x.mergeAuthorized === true,
    project,
    base,
    coordinator,
    hookSession: str2(x.hookSession),
    startedAt,
    lastTickAt: iso(x.lastTickAt),
    lastBlockTick: iso(x.lastBlockTick),
    sleepUntil: iso(x.sleepUntil),
    stopReason: oneOf(STOP_REASONS, x.stopReason),
    stallReason: str2(x.stallReason),
    notice: n && kind && iso(n.at) ? { kind, track: str2(n.track), at: iso(n.at) } : null,
    fronts
  };
}
function parseSwarm(text) {
  if (typeof text !== "string") return null;
  try {
    return normalizeSwarm(JSON.parse(text));
  } catch {
    return null;
  }
}

// src/forge/swarm.ts
var swarmFile = (root) => import_node_path3.default.join(root, ".forge", "swarm.json");
function readSwarm(root) {
  const file = swarmFile(root);
  if (!(0, import_node_fs3.existsSync)(file)) return null;
  try {
    return parseSwarm((0, import_node_fs3.readFileSync)(file, "utf8"));
  } catch {
    return null;
  }
}

// src/lib/types.ts
var TRACK_COLORS = ["blue", "mauve", "teal", "pink", "sky", "flamingo"];
var STAGES = ["brief", "implement", "validate", "verify", "review", "verdict", "integrate"];
var LOOSE_MAX_TASKS = 20;

// src/lib/plan.ts
var import_yaml = __toESM(require_dist(), 1);

// node_modules/zod/v3/external.js
var external_exports = {};
__export(external_exports, {
  BRAND: () => BRAND,
  DIRTY: () => DIRTY,
  EMPTY_PATH: () => EMPTY_PATH,
  INVALID: () => INVALID,
  NEVER: () => NEVER,
  OK: () => OK,
  ParseStatus: () => ParseStatus,
  Schema: () => ZodType,
  ZodAny: () => ZodAny,
  ZodArray: () => ZodArray,
  ZodBigInt: () => ZodBigInt,
  ZodBoolean: () => ZodBoolean,
  ZodBranded: () => ZodBranded,
  ZodCatch: () => ZodCatch,
  ZodDate: () => ZodDate,
  ZodDefault: () => ZodDefault,
  ZodDiscriminatedUnion: () => ZodDiscriminatedUnion,
  ZodEffects: () => ZodEffects,
  ZodEnum: () => ZodEnum,
  ZodError: () => ZodError,
  ZodFirstPartyTypeKind: () => ZodFirstPartyTypeKind,
  ZodFunction: () => ZodFunction,
  ZodIntersection: () => ZodIntersection,
  ZodIssueCode: () => ZodIssueCode,
  ZodLazy: () => ZodLazy,
  ZodLiteral: () => ZodLiteral,
  ZodMap: () => ZodMap,
  ZodNaN: () => ZodNaN,
  ZodNativeEnum: () => ZodNativeEnum,
  ZodNever: () => ZodNever,
  ZodNull: () => ZodNull,
  ZodNullable: () => ZodNullable,
  ZodNumber: () => ZodNumber,
  ZodObject: () => ZodObject,
  ZodOptional: () => ZodOptional,
  ZodParsedType: () => ZodParsedType,
  ZodPipeline: () => ZodPipeline,
  ZodPromise: () => ZodPromise,
  ZodReadonly: () => ZodReadonly,
  ZodRecord: () => ZodRecord,
  ZodSchema: () => ZodType,
  ZodSet: () => ZodSet,
  ZodString: () => ZodString,
  ZodSymbol: () => ZodSymbol,
  ZodTransformer: () => ZodEffects,
  ZodTuple: () => ZodTuple,
  ZodType: () => ZodType,
  ZodUndefined: () => ZodUndefined,
  ZodUnion: () => ZodUnion,
  ZodUnknown: () => ZodUnknown,
  ZodVoid: () => ZodVoid,
  addIssueToContext: () => addIssueToContext,
  any: () => anyType,
  array: () => arrayType,
  bigint: () => bigIntType,
  boolean: () => booleanType,
  coerce: () => coerce,
  custom: () => custom,
  date: () => dateType,
  datetimeRegex: () => datetimeRegex,
  defaultErrorMap: () => en_default,
  discriminatedUnion: () => discriminatedUnionType,
  effect: () => effectsType,
  enum: () => enumType,
  function: () => functionType,
  getErrorMap: () => getErrorMap,
  getParsedType: () => getParsedType,
  instanceof: () => instanceOfType,
  intersection: () => intersectionType,
  isAborted: () => isAborted,
  isAsync: () => isAsync,
  isDirty: () => isDirty,
  isValid: () => isValid,
  late: () => late,
  lazy: () => lazyType,
  literal: () => literalType,
  makeIssue: () => makeIssue,
  map: () => mapType,
  nan: () => nanType,
  nativeEnum: () => nativeEnumType,
  never: () => neverType,
  null: () => nullType,
  nullable: () => nullableType,
  number: () => numberType,
  object: () => objectType,
  objectUtil: () => objectUtil,
  oboolean: () => oboolean,
  onumber: () => onumber,
  optional: () => optionalType,
  ostring: () => ostring,
  pipeline: () => pipelineType,
  preprocess: () => preprocessType,
  promise: () => promiseType,
  quotelessJson: () => quotelessJson,
  record: () => recordType,
  set: () => setType,
  setErrorMap: () => setErrorMap,
  strictObject: () => strictObjectType,
  string: () => stringType,
  symbol: () => symbolType,
  transformer: () => effectsType,
  tuple: () => tupleType,
  undefined: () => undefinedType,
  union: () => unionType,
  unknown: () => unknownType,
  util: () => util,
  void: () => voidType
});

// node_modules/zod/v3/helpers/util.js
var util;
(function(util2) {
  util2.assertEqual = (_) => {
  };
  function assertIs(_arg) {
  }
  util2.assertIs = assertIs;
  function assertNever(_x) {
    throw new Error();
  }
  util2.assertNever = assertNever;
  util2.arrayToEnum = (items) => {
    const obj = {};
    for (const item of items) {
      obj[item] = item;
    }
    return obj;
  };
  util2.getValidEnumValues = (obj) => {
    const validKeys = util2.objectKeys(obj).filter((k) => typeof obj[obj[k]] !== "number");
    const filtered = {};
    for (const k of validKeys) {
      filtered[k] = obj[k];
    }
    return util2.objectValues(filtered);
  };
  util2.objectValues = (obj) => {
    return util2.objectKeys(obj).map(function(e) {
      return obj[e];
    });
  };
  util2.objectKeys = typeof Object.keys === "function" ? (obj) => Object.keys(obj) : (object) => {
    const keys = [];
    for (const key in object) {
      if (Object.prototype.hasOwnProperty.call(object, key)) {
        keys.push(key);
      }
    }
    return keys;
  };
  util2.find = (arr, checker) => {
    for (const item of arr) {
      if (checker(item))
        return item;
    }
    return void 0;
  };
  util2.isInteger = typeof Number.isInteger === "function" ? (val) => Number.isInteger(val) : (val) => typeof val === "number" && Number.isFinite(val) && Math.floor(val) === val;
  function joinValues(array, separator = " | ") {
    return array.map((val) => typeof val === "string" ? `'${val}'` : val).join(separator);
  }
  util2.joinValues = joinValues;
  util2.jsonStringifyReplacer = (_, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    return value;
  };
})(util || (util = {}));
var objectUtil;
(function(objectUtil2) {
  objectUtil2.mergeShapes = (first, second) => {
    return {
      ...first,
      ...second
      // second overwrites first
    };
  };
})(objectUtil || (objectUtil = {}));
var ZodParsedType = util.arrayToEnum([
  "string",
  "nan",
  "number",
  "integer",
  "float",
  "boolean",
  "date",
  "bigint",
  "symbol",
  "function",
  "undefined",
  "null",
  "array",
  "object",
  "unknown",
  "promise",
  "void",
  "never",
  "map",
  "set"
]);
var getParsedType = (data) => {
  const t = typeof data;
  switch (t) {
    case "undefined":
      return ZodParsedType.undefined;
    case "string":
      return ZodParsedType.string;
    case "number":
      return Number.isNaN(data) ? ZodParsedType.nan : ZodParsedType.number;
    case "boolean":
      return ZodParsedType.boolean;
    case "function":
      return ZodParsedType.function;
    case "bigint":
      return ZodParsedType.bigint;
    case "symbol":
      return ZodParsedType.symbol;
    case "object":
      if (Array.isArray(data)) {
        return ZodParsedType.array;
      }
      if (data === null) {
        return ZodParsedType.null;
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return ZodParsedType.promise;
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return ZodParsedType.map;
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return ZodParsedType.set;
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return ZodParsedType.date;
      }
      return ZodParsedType.object;
    default:
      return ZodParsedType.unknown;
  }
};

// node_modules/zod/v3/ZodError.js
var ZodIssueCode = util.arrayToEnum([
  "invalid_type",
  "invalid_literal",
  "custom",
  "invalid_union",
  "invalid_union_discriminator",
  "invalid_enum_value",
  "unrecognized_keys",
  "invalid_arguments",
  "invalid_return_type",
  "invalid_date",
  "invalid_string",
  "too_small",
  "too_big",
  "invalid_intersection_types",
  "not_multiple_of",
  "not_finite"
]);
var quotelessJson = (obj) => {
  const json = JSON.stringify(obj, null, 2);
  return json.replace(/"([^"]+)":/g, "$1:");
};
var ZodError = class _ZodError extends Error {
  get errors() {
    return this.issues;
  }
  constructor(issues) {
    super();
    this.issues = [];
    this.addIssue = (sub) => {
      this.issues = [...this.issues, sub];
    };
    this.addIssues = (subs = []) => {
      this.issues = [...this.issues, ...subs];
    };
    const actualProto = new.target.prototype;
    if (Object.setPrototypeOf) {
      Object.setPrototypeOf(this, actualProto);
    } else {
      this.__proto__ = actualProto;
    }
    this.name = "ZodError";
    this.issues = issues;
  }
  format(_mapper) {
    const mapper = _mapper || function(issue) {
      return issue.message;
    };
    const fieldErrors = { _errors: [] };
    const processError = (error) => {
      for (const issue of error.issues) {
        if (issue.code === "invalid_union") {
          issue.unionErrors.map(processError);
        } else if (issue.code === "invalid_return_type") {
          processError(issue.returnTypeError);
        } else if (issue.code === "invalid_arguments") {
          processError(issue.argumentsError);
        } else if (issue.path.length === 0) {
          fieldErrors._errors.push(mapper(issue));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < issue.path.length) {
            const el = issue.path[i];
            const terminal = i === issue.path.length - 1;
            if (!terminal) {
              curr[el] = curr[el] || { _errors: [] };
            } else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue));
            }
            curr = curr[el];
            i++;
          }
        }
      }
    };
    processError(this);
    return fieldErrors;
  }
  static assert(value) {
    if (!(value instanceof _ZodError)) {
      throw new Error(`Not a ZodError: ${value}`);
    }
  }
  toString() {
    return this.message;
  }
  get message() {
    return JSON.stringify(this.issues, util.jsonStringifyReplacer, 2);
  }
  get isEmpty() {
    return this.issues.length === 0;
  }
  flatten(mapper = (issue) => issue.message) {
    const fieldErrors = {};
    const formErrors = [];
    for (const sub of this.issues) {
      if (sub.path.length > 0) {
        const firstEl = sub.path[0];
        fieldErrors[firstEl] = fieldErrors[firstEl] || [];
        fieldErrors[firstEl].push(mapper(sub));
      } else {
        formErrors.push(mapper(sub));
      }
    }
    return { formErrors, fieldErrors };
  }
  get formErrors() {
    return this.flatten();
  }
};
ZodError.create = (issues) => {
  const error = new ZodError(issues);
  return error;
};

// node_modules/zod/v3/locales/en.js
var errorMap = (issue, _ctx) => {
  let message;
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === ZodParsedType.undefined) {
        message = "Required";
      } else {
        message = `Expected ${issue.expected}, received ${issue.received}`;
      }
      break;
    case ZodIssueCode.invalid_literal:
      message = `Invalid literal value, expected ${JSON.stringify(issue.expected, util.jsonStringifyReplacer)}`;
      break;
    case ZodIssueCode.unrecognized_keys:
      message = `Unrecognized key(s) in object: ${util.joinValues(issue.keys, ", ")}`;
      break;
    case ZodIssueCode.invalid_union:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_union_discriminator:
      message = `Invalid discriminator value. Expected ${util.joinValues(issue.options)}`;
      break;
    case ZodIssueCode.invalid_enum_value:
      message = `Invalid enum value. Expected ${util.joinValues(issue.options)}, received '${issue.received}'`;
      break;
    case ZodIssueCode.invalid_arguments:
      message = `Invalid function arguments`;
      break;
    case ZodIssueCode.invalid_return_type:
      message = `Invalid function return type`;
      break;
    case ZodIssueCode.invalid_date:
      message = `Invalid date`;
      break;
    case ZodIssueCode.invalid_string:
      if (typeof issue.validation === "object") {
        if ("includes" in issue.validation) {
          message = `Invalid input: must include "${issue.validation.includes}"`;
          if (typeof issue.validation.position === "number") {
            message = `${message} at one or more positions greater than or equal to ${issue.validation.position}`;
          }
        } else if ("startsWith" in issue.validation) {
          message = `Invalid input: must start with "${issue.validation.startsWith}"`;
        } else if ("endsWith" in issue.validation) {
          message = `Invalid input: must end with "${issue.validation.endsWith}"`;
        } else {
          util.assertNever(issue.validation);
        }
      } else if (issue.validation !== "regex") {
        message = `Invalid ${issue.validation}`;
      } else {
        message = "Invalid";
      }
      break;
    case ZodIssueCode.too_small:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `more than`} ${issue.minimum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `over`} ${issue.minimum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "bigint")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${new Date(Number(issue.minimum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.too_big:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `less than`} ${issue.maximum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `under`} ${issue.maximum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "bigint")
        message = `BigInt must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly` : issue.inclusive ? `smaller than or equal to` : `smaller than`} ${new Date(Number(issue.maximum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.custom:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_intersection_types:
      message = `Intersection results could not be merged`;
      break;
    case ZodIssueCode.not_multiple_of:
      message = `Number must be a multiple of ${issue.multipleOf}`;
      break;
    case ZodIssueCode.not_finite:
      message = "Number must be finite";
      break;
    default:
      message = _ctx.defaultError;
      util.assertNever(issue);
  }
  return { message };
};
var en_default = errorMap;

// node_modules/zod/v3/errors.js
var overrideErrorMap = en_default;
function setErrorMap(map) {
  overrideErrorMap = map;
}
function getErrorMap() {
  return overrideErrorMap;
}

// node_modules/zod/v3/helpers/parseUtil.js
var makeIssue = (params) => {
  const { data, path: path17, errorMaps, issueData } = params;
  const fullPath = [...path17, ...issueData.path || []];
  const fullIssue = {
    ...issueData,
    path: fullPath
  };
  if (issueData.message !== void 0) {
    return {
      ...issueData,
      path: fullPath,
      message: issueData.message
    };
  }
  let errorMessage = "";
  const maps = errorMaps.filter((m) => !!m).slice().reverse();
  for (const map of maps) {
    errorMessage = map(fullIssue, { data, defaultError: errorMessage }).message;
  }
  return {
    ...issueData,
    path: fullPath,
    message: errorMessage
  };
};
var EMPTY_PATH = [];
function addIssueToContext(ctx, issueData) {
  const overrideMap = getErrorMap();
  const issue = makeIssue({
    issueData,
    data: ctx.data,
    path: ctx.path,
    errorMaps: [
      ctx.common.contextualErrorMap,
      // contextual error map is first priority
      ctx.schemaErrorMap,
      // then schema-bound map if available
      overrideMap,
      // then global override map
      overrideMap === en_default ? void 0 : en_default
      // then global default map
    ].filter((x) => !!x)
  });
  ctx.common.issues.push(issue);
}
var ParseStatus = class _ParseStatus {
  constructor() {
    this.value = "valid";
  }
  dirty() {
    if (this.value === "valid")
      this.value = "dirty";
  }
  abort() {
    if (this.value !== "aborted")
      this.value = "aborted";
  }
  static mergeArray(status, results) {
    const arrayValue = [];
    for (const s2 of results) {
      if (s2.status === "aborted")
        return INVALID;
      if (s2.status === "dirty")
        status.dirty();
      arrayValue.push(s2.value);
    }
    return { status: status.value, value: arrayValue };
  }
  static async mergeObjectAsync(status, pairs) {
    const syncPairs = [];
    for (const pair of pairs) {
      const key = await pair.key;
      const value = await pair.value;
      syncPairs.push({
        key,
        value
      });
    }
    return _ParseStatus.mergeObjectSync(status, syncPairs);
  }
  static mergeObjectSync(status, pairs) {
    const finalObject = {};
    for (const pair of pairs) {
      const { key, value } = pair;
      if (key.status === "aborted")
        return INVALID;
      if (value.status === "aborted")
        return INVALID;
      if (key.status === "dirty")
        status.dirty();
      if (value.status === "dirty")
        status.dirty();
      if (key.value !== "__proto__" && (typeof value.value !== "undefined" || pair.alwaysSet)) {
        finalObject[key.value] = value.value;
      }
    }
    return { status: status.value, value: finalObject };
  }
};
var INVALID = Object.freeze({
  status: "aborted"
});
var DIRTY = (value) => ({ status: "dirty", value });
var OK = (value) => ({ status: "valid", value });
var isAborted = (x) => x.status === "aborted";
var isDirty = (x) => x.status === "dirty";
var isValid = (x) => x.status === "valid";
var isAsync = (x) => typeof Promise !== "undefined" && x instanceof Promise;

// node_modules/zod/v3/helpers/errorUtil.js
var errorUtil;
(function(errorUtil2) {
  errorUtil2.errToObj = (message) => typeof message === "string" ? { message } : message || {};
  errorUtil2.toString = (message) => typeof message === "string" ? message : message?.message;
})(errorUtil || (errorUtil = {}));

// node_modules/zod/v3/types.js
var ParseInputLazyPath = class {
  constructor(parent, value, path17, key) {
    this._cachedPath = [];
    this.parent = parent;
    this.data = value;
    this._path = path17;
    this._key = key;
  }
  get path() {
    if (!this._cachedPath.length) {
      if (Array.isArray(this._key)) {
        this._cachedPath.push(...this._path, ...this._key);
      } else {
        this._cachedPath.push(...this._path, this._key);
      }
    }
    return this._cachedPath;
  }
};
var handleResult = (ctx, result) => {
  if (isValid(result)) {
    return { success: true, data: result.value };
  } else {
    if (!ctx.common.issues.length) {
      throw new Error("Validation failed but no issues detected.");
    }
    return {
      success: false,
      get error() {
        if (this._error)
          return this._error;
        const error = new ZodError(ctx.common.issues);
        this._error = error;
        return this._error;
      }
    };
  }
};
function processCreateParams(params) {
  if (!params)
    return {};
  const { errorMap: errorMap2, invalid_type_error, required_error, description } = params;
  if (errorMap2 && (invalid_type_error || required_error)) {
    throw new Error(`Can't use "invalid_type_error" or "required_error" in conjunction with custom error map.`);
  }
  if (errorMap2)
    return { errorMap: errorMap2, description };
  const customMap = (iss, ctx) => {
    const { message } = params;
    if (iss.code === "invalid_enum_value") {
      return { message: message ?? ctx.defaultError };
    }
    if (typeof ctx.data === "undefined") {
      return { message: message ?? required_error ?? ctx.defaultError };
    }
    if (iss.code !== "invalid_type")
      return { message: ctx.defaultError };
    return { message: message ?? invalid_type_error ?? ctx.defaultError };
  };
  return { errorMap: customMap, description };
}
var ZodType = class {
  get description() {
    return this._def.description;
  }
  _getType(input) {
    return getParsedType(input.data);
  }
  _getOrReturnCtx(input, ctx) {
    return ctx || {
      common: input.parent.common,
      data: input.data,
      parsedType: getParsedType(input.data),
      schemaErrorMap: this._def.errorMap,
      path: input.path,
      parent: input.parent
    };
  }
  _processInputParams(input) {
    return {
      status: new ParseStatus(),
      ctx: {
        common: input.parent.common,
        data: input.data,
        parsedType: getParsedType(input.data),
        schemaErrorMap: this._def.errorMap,
        path: input.path,
        parent: input.parent
      }
    };
  }
  _parseSync(input) {
    const result = this._parse(input);
    if (isAsync(result)) {
      throw new Error("Synchronous parse encountered promise.");
    }
    return result;
  }
  _parseAsync(input) {
    const result = this._parse(input);
    return Promise.resolve(result);
  }
  parse(data, params) {
    const result = this.safeParse(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  safeParse(data, params) {
    const ctx = {
      common: {
        issues: [],
        async: params?.async ?? false,
        contextualErrorMap: params?.errorMap
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const result = this._parseSync({ data, path: ctx.path, parent: ctx });
    return handleResult(ctx, result);
  }
  "~validate"(data) {
    const ctx = {
      common: {
        issues: [],
        async: !!this["~standard"].async
      },
      path: [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    if (!this["~standard"].async) {
      try {
        const result = this._parseSync({ data, path: [], parent: ctx });
        return isValid(result) ? {
          value: result.value
        } : {
          issues: ctx.common.issues
        };
      } catch (err) {
        if (err?.message?.toLowerCase()?.includes("encountered")) {
          this["~standard"].async = true;
        }
        ctx.common = {
          issues: [],
          async: true
        };
      }
    }
    return this._parseAsync({ data, path: [], parent: ctx }).then((result) => isValid(result) ? {
      value: result.value
    } : {
      issues: ctx.common.issues
    });
  }
  async parseAsync(data, params) {
    const result = await this.safeParseAsync(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  async safeParseAsync(data, params) {
    const ctx = {
      common: {
        issues: [],
        contextualErrorMap: params?.errorMap,
        async: true
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const maybeAsyncResult = this._parse({ data, path: ctx.path, parent: ctx });
    const result = await (isAsync(maybeAsyncResult) ? maybeAsyncResult : Promise.resolve(maybeAsyncResult));
    return handleResult(ctx, result);
  }
  refine(check, message) {
    const getIssueProperties = (val) => {
      if (typeof message === "string" || typeof message === "undefined") {
        return { message };
      } else if (typeof message === "function") {
        return message(val);
      } else {
        return message;
      }
    };
    return this._refinement((val, ctx) => {
      const result = check(val);
      const setError = () => ctx.addIssue({
        code: ZodIssueCode.custom,
        ...getIssueProperties(val)
      });
      if (typeof Promise !== "undefined" && result instanceof Promise) {
        return result.then((data) => {
          if (!data) {
            setError();
            return false;
          } else {
            return true;
          }
        });
      }
      if (!result) {
        setError();
        return false;
      } else {
        return true;
      }
    });
  }
  refinement(check, refinementData) {
    return this._refinement((val, ctx) => {
      if (!check(val)) {
        ctx.addIssue(typeof refinementData === "function" ? refinementData(val, ctx) : refinementData);
        return false;
      } else {
        return true;
      }
    });
  }
  _refinement(refinement) {
    return new ZodEffects({
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "refinement", refinement }
    });
  }
  superRefine(refinement) {
    return this._refinement(refinement);
  }
  constructor(def) {
    this.spa = this.safeParseAsync;
    this._def = def;
    this.parse = this.parse.bind(this);
    this.safeParse = this.safeParse.bind(this);
    this.parseAsync = this.parseAsync.bind(this);
    this.safeParseAsync = this.safeParseAsync.bind(this);
    this.spa = this.spa.bind(this);
    this.refine = this.refine.bind(this);
    this.refinement = this.refinement.bind(this);
    this.superRefine = this.superRefine.bind(this);
    this.optional = this.optional.bind(this);
    this.nullable = this.nullable.bind(this);
    this.nullish = this.nullish.bind(this);
    this.array = this.array.bind(this);
    this.promise = this.promise.bind(this);
    this.or = this.or.bind(this);
    this.and = this.and.bind(this);
    this.transform = this.transform.bind(this);
    this.brand = this.brand.bind(this);
    this.default = this.default.bind(this);
    this.catch = this.catch.bind(this);
    this.describe = this.describe.bind(this);
    this.pipe = this.pipe.bind(this);
    this.readonly = this.readonly.bind(this);
    this.isNullable = this.isNullable.bind(this);
    this.isOptional = this.isOptional.bind(this);
    this["~standard"] = {
      version: 1,
      vendor: "zod",
      validate: (data) => this["~validate"](data)
    };
  }
  optional() {
    return ZodOptional.create(this, this._def);
  }
  nullable() {
    return ZodNullable.create(this, this._def);
  }
  nullish() {
    return this.nullable().optional();
  }
  array() {
    return ZodArray.create(this);
  }
  promise() {
    return ZodPromise.create(this, this._def);
  }
  or(option) {
    return ZodUnion.create([this, option], this._def);
  }
  and(incoming) {
    return ZodIntersection.create(this, incoming, this._def);
  }
  transform(transform) {
    return new ZodEffects({
      ...processCreateParams(this._def),
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "transform", transform }
    });
  }
  default(def) {
    const defaultValueFunc = typeof def === "function" ? def : () => def;
    return new ZodDefault({
      ...processCreateParams(this._def),
      innerType: this,
      defaultValue: defaultValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodDefault
    });
  }
  brand() {
    return new ZodBranded({
      typeName: ZodFirstPartyTypeKind.ZodBranded,
      type: this,
      ...processCreateParams(this._def)
    });
  }
  catch(def) {
    const catchValueFunc = typeof def === "function" ? def : () => def;
    return new ZodCatch({
      ...processCreateParams(this._def),
      innerType: this,
      catchValue: catchValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodCatch
    });
  }
  describe(description) {
    const This = this.constructor;
    return new This({
      ...this._def,
      description
    });
  }
  pipe(target) {
    return ZodPipeline.create(this, target);
  }
  readonly() {
    return ZodReadonly.create(this);
  }
  isOptional() {
    return this.safeParse(void 0).success;
  }
  isNullable() {
    return this.safeParse(null).success;
  }
};
var cuidRegex = /^c[^\s-]{8,}$/i;
var cuid2Regex = /^[0-9a-z]+$/;
var ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
var uuidRegex = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
var nanoidRegex = /^[a-z0-9_-]{21}$/i;
var jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
var durationRegex = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
var emailRegex = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
var _emojiRegex = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
var emojiRegex;
var ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv4CidrRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/;
var ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
var ipv6CidrRegex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64Regex = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
var base64urlRegex = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/;
var dateRegexSource = `((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`;
var dateRegex = new RegExp(`^${dateRegexSource}$`);
function timeRegexSource(args) {
  let secondsRegexSource = `[0-5]\\d`;
  if (args.precision) {
    secondsRegexSource = `${secondsRegexSource}\\.\\d{${args.precision}}`;
  } else if (args.precision == null) {
    secondsRegexSource = `${secondsRegexSource}(\\.\\d+)?`;
  }
  const secondsQuantifier = args.precision ? "+" : "?";
  return `([01]\\d|2[0-3]):[0-5]\\d(:${secondsRegexSource})${secondsQuantifier}`;
}
function timeRegex(args) {
  return new RegExp(`^${timeRegexSource(args)}$`);
}
function datetimeRegex(args) {
  let regex = `${dateRegexSource}T${timeRegexSource(args)}`;
  const opts = [];
  opts.push(args.local ? `Z?` : `Z`);
  if (args.offset)
    opts.push(`([+-]\\d{2}:?\\d{2})`);
  regex = `${regex}(${opts.join("|")})`;
  return new RegExp(`^${regex}$`);
}
function isValidIP(ip, version) {
  if ((version === "v4" || !version) && ipv4Regex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6Regex.test(ip)) {
    return true;
  }
  return false;
}
function isValidJWT(jwt, alg) {
  if (!jwtRegex.test(jwt))
    return false;
  try {
    const [header] = jwt.split(".");
    if (!header)
      return false;
    const base64 = header.replace(/-/g, "+").replace(/_/g, "/").padEnd(header.length + (4 - header.length % 4) % 4, "=");
    const decoded = JSON.parse(atob(base64));
    if (typeof decoded !== "object" || decoded === null)
      return false;
    if ("typ" in decoded && decoded?.typ !== "JWT")
      return false;
    if (!decoded.alg)
      return false;
    if (alg && decoded.alg !== alg)
      return false;
    return true;
  } catch {
    return false;
  }
}
function isValidCidr(ip, version) {
  if ((version === "v4" || !version) && ipv4CidrRegex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6CidrRegex.test(ip)) {
    return true;
  }
  return false;
}
var ZodString = class _ZodString extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = String(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.string) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.string,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.length < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.length > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "length") {
        const tooBig = input.data.length > check.value;
        const tooSmall = input.data.length < check.value;
        if (tooBig || tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          if (tooBig) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              maximum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          } else if (tooSmall) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              minimum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          }
          status.dirty();
        }
      } else if (check.kind === "email") {
        if (!emailRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "email",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "emoji") {
        if (!emojiRegex) {
          emojiRegex = new RegExp(_emojiRegex, "u");
        }
        if (!emojiRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "emoji",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "uuid") {
        if (!uuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "uuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "nanoid") {
        if (!nanoidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "nanoid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid") {
        if (!cuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid2") {
        if (!cuid2Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid2",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ulid") {
        if (!ulidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ulid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "url") {
        try {
          new URL(input.data);
        } catch {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "regex") {
        check.regex.lastIndex = 0;
        const testResult = check.regex.test(input.data);
        if (!testResult) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "regex",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "trim") {
        input.data = input.data.trim();
      } else if (check.kind === "includes") {
        if (!input.data.includes(check.value, check.position)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { includes: check.value, position: check.position },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "toLowerCase") {
        input.data = input.data.toLowerCase();
      } else if (check.kind === "toUpperCase") {
        input.data = input.data.toUpperCase();
      } else if (check.kind === "startsWith") {
        if (!input.data.startsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { startsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "endsWith") {
        if (!input.data.endsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { endsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "datetime") {
        const regex = datetimeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "datetime",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "date") {
        const regex = dateRegex;
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "date",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "time") {
        const regex = timeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "time",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "duration") {
        if (!durationRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "duration",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ip") {
        if (!isValidIP(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ip",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "jwt") {
        if (!isValidJWT(input.data, check.alg)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "jwt",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cidr") {
        if (!isValidCidr(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cidr",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64") {
        if (!base64Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64url") {
        if (!base64urlRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _regex(regex, validation, message) {
    return this.refinement((data) => regex.test(data), {
      validation,
      code: ZodIssueCode.invalid_string,
      ...errorUtil.errToObj(message)
    });
  }
  _addCheck(check) {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  email(message) {
    return this._addCheck({ kind: "email", ...errorUtil.errToObj(message) });
  }
  url(message) {
    return this._addCheck({ kind: "url", ...errorUtil.errToObj(message) });
  }
  emoji(message) {
    return this._addCheck({ kind: "emoji", ...errorUtil.errToObj(message) });
  }
  uuid(message) {
    return this._addCheck({ kind: "uuid", ...errorUtil.errToObj(message) });
  }
  nanoid(message) {
    return this._addCheck({ kind: "nanoid", ...errorUtil.errToObj(message) });
  }
  cuid(message) {
    return this._addCheck({ kind: "cuid", ...errorUtil.errToObj(message) });
  }
  cuid2(message) {
    return this._addCheck({ kind: "cuid2", ...errorUtil.errToObj(message) });
  }
  ulid(message) {
    return this._addCheck({ kind: "ulid", ...errorUtil.errToObj(message) });
  }
  base64(message) {
    return this._addCheck({ kind: "base64", ...errorUtil.errToObj(message) });
  }
  base64url(message) {
    return this._addCheck({
      kind: "base64url",
      ...errorUtil.errToObj(message)
    });
  }
  jwt(options) {
    return this._addCheck({ kind: "jwt", ...errorUtil.errToObj(options) });
  }
  ip(options) {
    return this._addCheck({ kind: "ip", ...errorUtil.errToObj(options) });
  }
  cidr(options) {
    return this._addCheck({ kind: "cidr", ...errorUtil.errToObj(options) });
  }
  datetime(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "datetime",
        precision: null,
        offset: false,
        local: false,
        message: options
      });
    }
    return this._addCheck({
      kind: "datetime",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      offset: options?.offset ?? false,
      local: options?.local ?? false,
      ...errorUtil.errToObj(options?.message)
    });
  }
  date(message) {
    return this._addCheck({ kind: "date", message });
  }
  time(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "time",
        precision: null,
        message: options
      });
    }
    return this._addCheck({
      kind: "time",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      ...errorUtil.errToObj(options?.message)
    });
  }
  duration(message) {
    return this._addCheck({ kind: "duration", ...errorUtil.errToObj(message) });
  }
  regex(regex, message) {
    return this._addCheck({
      kind: "regex",
      regex,
      ...errorUtil.errToObj(message)
    });
  }
  includes(value, options) {
    return this._addCheck({
      kind: "includes",
      value,
      position: options?.position,
      ...errorUtil.errToObj(options?.message)
    });
  }
  startsWith(value, message) {
    return this._addCheck({
      kind: "startsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  endsWith(value, message) {
    return this._addCheck({
      kind: "endsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  min(minLength, message) {
    return this._addCheck({
      kind: "min",
      value: minLength,
      ...errorUtil.errToObj(message)
    });
  }
  max(maxLength, message) {
    return this._addCheck({
      kind: "max",
      value: maxLength,
      ...errorUtil.errToObj(message)
    });
  }
  length(len, message) {
    return this._addCheck({
      kind: "length",
      value: len,
      ...errorUtil.errToObj(message)
    });
  }
  /**
   * Equivalent to `.min(1)`
   */
  nonempty(message) {
    return this.min(1, errorUtil.errToObj(message));
  }
  trim() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "trim" }]
    });
  }
  toLowerCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toLowerCase" }]
    });
  }
  toUpperCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toUpperCase" }]
    });
  }
  get isDatetime() {
    return !!this._def.checks.find((ch) => ch.kind === "datetime");
  }
  get isDate() {
    return !!this._def.checks.find((ch) => ch.kind === "date");
  }
  get isTime() {
    return !!this._def.checks.find((ch) => ch.kind === "time");
  }
  get isDuration() {
    return !!this._def.checks.find((ch) => ch.kind === "duration");
  }
  get isEmail() {
    return !!this._def.checks.find((ch) => ch.kind === "email");
  }
  get isURL() {
    return !!this._def.checks.find((ch) => ch.kind === "url");
  }
  get isEmoji() {
    return !!this._def.checks.find((ch) => ch.kind === "emoji");
  }
  get isUUID() {
    return !!this._def.checks.find((ch) => ch.kind === "uuid");
  }
  get isNANOID() {
    return !!this._def.checks.find((ch) => ch.kind === "nanoid");
  }
  get isCUID() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid");
  }
  get isCUID2() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid2");
  }
  get isULID() {
    return !!this._def.checks.find((ch) => ch.kind === "ulid");
  }
  get isIP() {
    return !!this._def.checks.find((ch) => ch.kind === "ip");
  }
  get isCIDR() {
    return !!this._def.checks.find((ch) => ch.kind === "cidr");
  }
  get isBase64() {
    return !!this._def.checks.find((ch) => ch.kind === "base64");
  }
  get isBase64url() {
    return !!this._def.checks.find((ch) => ch.kind === "base64url");
  }
  get minLength() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxLength() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodString.create = (params) => {
  return new ZodString({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodString,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
function floatSafeRemainder(val, step) {
  const valDecCount = (val.toString().split(".")[1] || "").length;
  const stepDecCount = (step.toString().split(".")[1] || "").length;
  const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
  const valInt = Number.parseInt(val.toFixed(decCount).replace(".", ""));
  const stepInt = Number.parseInt(step.toFixed(decCount).replace(".", ""));
  return valInt % stepInt / 10 ** decCount;
}
var ZodNumber = class _ZodNumber extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
    this.step = this.multipleOf;
  }
  _parse(input) {
    if (this._def.coerce) {
      input.data = Number(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.number) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.number,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "int") {
        if (!util.isInteger(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: "integer",
            received: "float",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (floatSafeRemainder(input.data, check.value) !== 0) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "finite") {
        if (!Number.isFinite(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_finite,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodNumber({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodNumber({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  int(message) {
    return this._addCheck({
      kind: "int",
      message: errorUtil.toString(message)
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  finite(message) {
    return this._addCheck({
      kind: "finite",
      message: errorUtil.toString(message)
    });
  }
  safe(message) {
    return this._addCheck({
      kind: "min",
      inclusive: true,
      value: Number.MIN_SAFE_INTEGER,
      message: errorUtil.toString(message)
    })._addCheck({
      kind: "max",
      inclusive: true,
      value: Number.MAX_SAFE_INTEGER,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
  get isInt() {
    return !!this._def.checks.find((ch) => ch.kind === "int" || ch.kind === "multipleOf" && util.isInteger(ch.value));
  }
  get isFinite() {
    let max = null;
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "finite" || ch.kind === "int" || ch.kind === "multipleOf") {
        return true;
      } else if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      } else if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return Number.isFinite(min) && Number.isFinite(max);
  }
};
ZodNumber.create = (params) => {
  return new ZodNumber({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodNumber,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodBigInt = class _ZodBigInt extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
  }
  _parse(input) {
    if (this._def.coerce) {
      try {
        input.data = BigInt(input.data);
      } catch {
        return this._getInvalidInput(input);
      }
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.bigint) {
      return this._getInvalidInput(input);
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            type: "bigint",
            minimum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            type: "bigint",
            maximum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (input.data % check.value !== BigInt(0)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _getInvalidInput(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.bigint,
      received: ctx.parsedType
    });
    return INVALID;
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodBigInt({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodBigInt({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodBigInt.create = (params) => {
  return new ZodBigInt({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodBigInt,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
var ZodBoolean = class extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = Boolean(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.boolean) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.boolean,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodBoolean.create = (params) => {
  return new ZodBoolean({
    typeName: ZodFirstPartyTypeKind.ZodBoolean,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodDate = class _ZodDate extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = new Date(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.date) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.date,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    if (Number.isNaN(input.data.getTime())) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_date
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.getTime() < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            message: check.message,
            inclusive: true,
            exact: false,
            minimum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.getTime() > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            message: check.message,
            inclusive: true,
            exact: false,
            maximum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return {
      status: status.value,
      value: new Date(input.data.getTime())
    };
  }
  _addCheck(check) {
    return new _ZodDate({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  min(minDate, message) {
    return this._addCheck({
      kind: "min",
      value: minDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  max(maxDate, message) {
    return this._addCheck({
      kind: "max",
      value: maxDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  get minDate() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min != null ? new Date(min) : null;
  }
  get maxDate() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max != null ? new Date(max) : null;
  }
};
ZodDate.create = (params) => {
  return new ZodDate({
    checks: [],
    coerce: params?.coerce || false,
    typeName: ZodFirstPartyTypeKind.ZodDate,
    ...processCreateParams(params)
  });
};
var ZodSymbol = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.symbol) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.symbol,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodSymbol.create = (params) => {
  return new ZodSymbol({
    typeName: ZodFirstPartyTypeKind.ZodSymbol,
    ...processCreateParams(params)
  });
};
var ZodUndefined = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.undefined,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodUndefined.create = (params) => {
  return new ZodUndefined({
    typeName: ZodFirstPartyTypeKind.ZodUndefined,
    ...processCreateParams(params)
  });
};
var ZodNull = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.null) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.null,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodNull.create = (params) => {
  return new ZodNull({
    typeName: ZodFirstPartyTypeKind.ZodNull,
    ...processCreateParams(params)
  });
};
var ZodAny = class extends ZodType {
  constructor() {
    super(...arguments);
    this._any = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodAny.create = (params) => {
  return new ZodAny({
    typeName: ZodFirstPartyTypeKind.ZodAny,
    ...processCreateParams(params)
  });
};
var ZodUnknown = class extends ZodType {
  constructor() {
    super(...arguments);
    this._unknown = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodUnknown.create = (params) => {
  return new ZodUnknown({
    typeName: ZodFirstPartyTypeKind.ZodUnknown,
    ...processCreateParams(params)
  });
};
var ZodNever = class extends ZodType {
  _parse(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.never,
      received: ctx.parsedType
    });
    return INVALID;
  }
};
ZodNever.create = (params) => {
  return new ZodNever({
    typeName: ZodFirstPartyTypeKind.ZodNever,
    ...processCreateParams(params)
  });
};
var ZodVoid = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.void,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodVoid.create = (params) => {
  return new ZodVoid({
    typeName: ZodFirstPartyTypeKind.ZodVoid,
    ...processCreateParams(params)
  });
};
var ZodArray = class _ZodArray extends ZodType {
  _parse(input) {
    const { ctx, status } = this._processInputParams(input);
    const def = this._def;
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (def.exactLength !== null) {
      const tooBig = ctx.data.length > def.exactLength.value;
      const tooSmall = ctx.data.length < def.exactLength.value;
      if (tooBig || tooSmall) {
        addIssueToContext(ctx, {
          code: tooBig ? ZodIssueCode.too_big : ZodIssueCode.too_small,
          minimum: tooSmall ? def.exactLength.value : void 0,
          maximum: tooBig ? def.exactLength.value : void 0,
          type: "array",
          inclusive: true,
          exact: true,
          message: def.exactLength.message
        });
        status.dirty();
      }
    }
    if (def.minLength !== null) {
      if (ctx.data.length < def.minLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.minLength.message
        });
        status.dirty();
      }
    }
    if (def.maxLength !== null) {
      if (ctx.data.length > def.maxLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.maxLength.message
        });
        status.dirty();
      }
    }
    if (ctx.common.async) {
      return Promise.all([...ctx.data].map((item, i) => {
        return def.type._parseAsync(new ParseInputLazyPath(ctx, item, ctx.path, i));
      })).then((result2) => {
        return ParseStatus.mergeArray(status, result2);
      });
    }
    const result = [...ctx.data].map((item, i) => {
      return def.type._parseSync(new ParseInputLazyPath(ctx, item, ctx.path, i));
    });
    return ParseStatus.mergeArray(status, result);
  }
  get element() {
    return this._def.type;
  }
  min(minLength, message) {
    return new _ZodArray({
      ...this._def,
      minLength: { value: minLength, message: errorUtil.toString(message) }
    });
  }
  max(maxLength, message) {
    return new _ZodArray({
      ...this._def,
      maxLength: { value: maxLength, message: errorUtil.toString(message) }
    });
  }
  length(len, message) {
    return new _ZodArray({
      ...this._def,
      exactLength: { value: len, message: errorUtil.toString(message) }
    });
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodArray.create = (schema, params) => {
  return new ZodArray({
    type: schema,
    minLength: null,
    maxLength: null,
    exactLength: null,
    typeName: ZodFirstPartyTypeKind.ZodArray,
    ...processCreateParams(params)
  });
};
function deepPartialify(schema) {
  if (schema instanceof ZodObject) {
    const newShape = {};
    for (const key in schema.shape) {
      const fieldSchema = schema.shape[key];
      newShape[key] = ZodOptional.create(deepPartialify(fieldSchema));
    }
    return new ZodObject({
      ...schema._def,
      shape: () => newShape
    });
  } else if (schema instanceof ZodArray) {
    return new ZodArray({
      ...schema._def,
      type: deepPartialify(schema.element)
    });
  } else if (schema instanceof ZodOptional) {
    return ZodOptional.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodNullable) {
    return ZodNullable.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodTuple) {
    return ZodTuple.create(schema.items.map((item) => deepPartialify(item)));
  } else {
    return schema;
  }
}
var ZodObject = class _ZodObject extends ZodType {
  constructor() {
    super(...arguments);
    this._cached = null;
    this.nonstrict = this.passthrough;
    this.augment = this.extend;
  }
  _getCached() {
    if (this._cached !== null)
      return this._cached;
    const shape = this._def.shape();
    const keys = util.objectKeys(shape);
    this._cached = { shape, keys };
    return this._cached;
  }
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.object) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const { status, ctx } = this._processInputParams(input);
    const { shape, keys: shapeKeys } = this._getCached();
    const extraKeys = [];
    if (!(this._def.catchall instanceof ZodNever && this._def.unknownKeys === "strip")) {
      for (const key in ctx.data) {
        if (!shapeKeys.includes(key)) {
          extraKeys.push(key);
        }
      }
    }
    const pairs = [];
    for (const key of shapeKeys) {
      const keyValidator = shape[key];
      const value = ctx.data[key];
      pairs.push({
        key: { status: "valid", value: key },
        value: keyValidator._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (this._def.catchall instanceof ZodNever) {
      const unknownKeys = this._def.unknownKeys;
      if (unknownKeys === "passthrough") {
        for (const key of extraKeys) {
          pairs.push({
            key: { status: "valid", value: key },
            value: { status: "valid", value: ctx.data[key] }
          });
        }
      } else if (unknownKeys === "strict") {
        if (extraKeys.length > 0) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.unrecognized_keys,
            keys: extraKeys
          });
          status.dirty();
        }
      } else if (unknownKeys === "strip") {
      } else {
        throw new Error(`Internal ZodObject error: invalid unknownKeys value.`);
      }
    } else {
      const catchall = this._def.catchall;
      for (const key of extraKeys) {
        const value = ctx.data[key];
        pairs.push({
          key: { status: "valid", value: key },
          value: catchall._parse(
            new ParseInputLazyPath(ctx, value, ctx.path, key)
            //, ctx.child(key), value, getParsedType(value)
          ),
          alwaysSet: key in ctx.data
        });
      }
    }
    if (ctx.common.async) {
      return Promise.resolve().then(async () => {
        const syncPairs = [];
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          syncPairs.push({
            key,
            value,
            alwaysSet: pair.alwaysSet
          });
        }
        return syncPairs;
      }).then((syncPairs) => {
        return ParseStatus.mergeObjectSync(status, syncPairs);
      });
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get shape() {
    return this._def.shape();
  }
  strict(message) {
    errorUtil.errToObj;
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strict",
      ...message !== void 0 ? {
        errorMap: (issue, ctx) => {
          const defaultError = this._def.errorMap?.(issue, ctx).message ?? ctx.defaultError;
          if (issue.code === "unrecognized_keys")
            return {
              message: errorUtil.errToObj(message).message ?? defaultError
            };
          return {
            message: defaultError
          };
        }
      } : {}
    });
  }
  strip() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strip"
    });
  }
  passthrough() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "passthrough"
    });
  }
  // const AugmentFactory =
  //   <Def extends ZodObjectDef>(def: Def) =>
  //   <Augmentation extends ZodRawShape>(
  //     augmentation: Augmentation
  //   ): ZodObject<
  //     extendShape<ReturnType<Def["shape"]>, Augmentation>,
  //     Def["unknownKeys"],
  //     Def["catchall"]
  //   > => {
  //     return new ZodObject({
  //       ...def,
  //       shape: () => ({
  //         ...def.shape(),
  //         ...augmentation,
  //       }),
  //     }) as any;
  //   };
  extend(augmentation) {
    return new _ZodObject({
      ...this._def,
      shape: () => ({
        ...this._def.shape(),
        ...augmentation
      })
    });
  }
  /**
   * Prior to zod@1.0.12 there was a bug in the
   * inferred type of merged objects. Please
   * upgrade if you are experiencing issues.
   */
  merge(merging) {
    const merged = new _ZodObject({
      unknownKeys: merging._def.unknownKeys,
      catchall: merging._def.catchall,
      shape: () => ({
        ...this._def.shape(),
        ...merging._def.shape()
      }),
      typeName: ZodFirstPartyTypeKind.ZodObject
    });
    return merged;
  }
  // merge<
  //   Incoming extends AnyZodObject,
  //   Augmentation extends Incoming["shape"],
  //   NewOutput extends {
  //     [k in keyof Augmentation | keyof Output]: k extends keyof Augmentation
  //       ? Augmentation[k]["_output"]
  //       : k extends keyof Output
  //       ? Output[k]
  //       : never;
  //   },
  //   NewInput extends {
  //     [k in keyof Augmentation | keyof Input]: k extends keyof Augmentation
  //       ? Augmentation[k]["_input"]
  //       : k extends keyof Input
  //       ? Input[k]
  //       : never;
  //   }
  // >(
  //   merging: Incoming
  // ): ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"],
  //   NewOutput,
  //   NewInput
  // > {
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  setKey(key, schema) {
    return this.augment({ [key]: schema });
  }
  // merge<Incoming extends AnyZodObject>(
  //   merging: Incoming
  // ): //ZodObject<T & Incoming["_shape"], UnknownKeys, Catchall> = (merging) => {
  // ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"]
  // > {
  //   // const mergedShape = objectUtil.mergeShapes(
  //   //   this._def.shape(),
  //   //   merging._def.shape()
  //   // );
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  catchall(index) {
    return new _ZodObject({
      ...this._def,
      catchall: index
    });
  }
  pick(mask) {
    const shape = {};
    for (const key of util.objectKeys(mask)) {
      if (mask[key] && this.shape[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  omit(mask) {
    const shape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (!mask[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  /**
   * @deprecated
   */
  deepPartial() {
    return deepPartialify(this);
  }
  partial(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      const fieldSchema = this.shape[key];
      if (mask && !mask[key]) {
        newShape[key] = fieldSchema;
      } else {
        newShape[key] = fieldSchema.optional();
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  required(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (mask && !mask[key]) {
        newShape[key] = this.shape[key];
      } else {
        const fieldSchema = this.shape[key];
        let newField = fieldSchema;
        while (newField instanceof ZodOptional) {
          newField = newField._def.innerType;
        }
        newShape[key] = newField;
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  keyof() {
    return createZodEnum(util.objectKeys(this.shape));
  }
};
ZodObject.create = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.strictCreate = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strict",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.lazycreate = (shape, params) => {
  return new ZodObject({
    shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
var ZodUnion = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const options = this._def.options;
    function handleResults(results) {
      for (const result of results) {
        if (result.result.status === "valid") {
          return result.result;
        }
      }
      for (const result of results) {
        if (result.result.status === "dirty") {
          ctx.common.issues.push(...result.ctx.common.issues);
          return result.result;
        }
      }
      const unionErrors = results.map((result) => new ZodError(result.ctx.common.issues));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return Promise.all(options.map(async (option) => {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        return {
          result: await option._parseAsync({
            data: ctx.data,
            path: ctx.path,
            parent: childCtx
          }),
          ctx: childCtx
        };
      })).then(handleResults);
    } else {
      let dirty = void 0;
      const issues = [];
      for (const option of options) {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        const result = option._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: childCtx
        });
        if (result.status === "valid") {
          return result;
        } else if (result.status === "dirty" && !dirty) {
          dirty = { result, ctx: childCtx };
        }
        if (childCtx.common.issues.length) {
          issues.push(childCtx.common.issues);
        }
      }
      if (dirty) {
        ctx.common.issues.push(...dirty.ctx.common.issues);
        return dirty.result;
      }
      const unionErrors = issues.map((issues2) => new ZodError(issues2));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
  }
  get options() {
    return this._def.options;
  }
};
ZodUnion.create = (types, params) => {
  return new ZodUnion({
    options: types,
    typeName: ZodFirstPartyTypeKind.ZodUnion,
    ...processCreateParams(params)
  });
};
var getDiscriminator = (type) => {
  if (type instanceof ZodLazy) {
    return getDiscriminator(type.schema);
  } else if (type instanceof ZodEffects) {
    return getDiscriminator(type.innerType());
  } else if (type instanceof ZodLiteral) {
    return [type.value];
  } else if (type instanceof ZodEnum) {
    return type.options;
  } else if (type instanceof ZodNativeEnum) {
    return util.objectValues(type.enum);
  } else if (type instanceof ZodDefault) {
    return getDiscriminator(type._def.innerType);
  } else if (type instanceof ZodUndefined) {
    return [void 0];
  } else if (type instanceof ZodNull) {
    return [null];
  } else if (type instanceof ZodOptional) {
    return [void 0, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodNullable) {
    return [null, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodBranded) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodReadonly) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodCatch) {
    return getDiscriminator(type._def.innerType);
  } else {
    return [];
  }
};
var ZodDiscriminatedUnion = class _ZodDiscriminatedUnion extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const discriminator = this.discriminator;
    const discriminatorValue = ctx.data[discriminator];
    const option = this.optionsMap.get(discriminatorValue);
    if (!option) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union_discriminator,
        options: Array.from(this.optionsMap.keys()),
        path: [discriminator]
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return option._parseAsync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    } else {
      return option._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    }
  }
  get discriminator() {
    return this._def.discriminator;
  }
  get options() {
    return this._def.options;
  }
  get optionsMap() {
    return this._def.optionsMap;
  }
  /**
   * The constructor of the discriminated union schema. Its behaviour is very similar to that of the normal z.union() constructor.
   * However, it only allows a union of objects, all of which need to share a discriminator property. This property must
   * have a different value for each object in the union.
   * @param discriminator the name of the discriminator property
   * @param types an array of object schemas
   * @param params
   */
  static create(discriminator, options, params) {
    const optionsMap = /* @__PURE__ */ new Map();
    for (const type of options) {
      const discriminatorValues = getDiscriminator(type.shape[discriminator]);
      if (!discriminatorValues.length) {
        throw new Error(`A discriminator value for key \`${discriminator}\` could not be extracted from all schema options`);
      }
      for (const value of discriminatorValues) {
        if (optionsMap.has(value)) {
          throw new Error(`Discriminator property ${String(discriminator)} has duplicate value ${String(value)}`);
        }
        optionsMap.set(value, type);
      }
    }
    return new _ZodDiscriminatedUnion({
      typeName: ZodFirstPartyTypeKind.ZodDiscriminatedUnion,
      discriminator,
      options,
      optionsMap,
      ...processCreateParams(params)
    });
  }
};
function mergeValues(a, b) {
  const aType = getParsedType(a);
  const bType = getParsedType(b);
  if (a === b) {
    return { valid: true, data: a };
  } else if (aType === ZodParsedType.object && bType === ZodParsedType.object) {
    const bKeys = util.objectKeys(b);
    const sharedKeys = util.objectKeys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  } else if (aType === ZodParsedType.array && bType === ZodParsedType.array) {
    if (a.length !== b.length) {
      return { valid: false };
    }
    const newArray = [];
    for (let index = 0; index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  } else if (aType === ZodParsedType.date && bType === ZodParsedType.date && +a === +b) {
    return { valid: true, data: a };
  } else {
    return { valid: false };
  }
}
var ZodIntersection = class extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const handleParsed = (parsedLeft, parsedRight) => {
      if (isAborted(parsedLeft) || isAborted(parsedRight)) {
        return INVALID;
      }
      const merged = mergeValues(parsedLeft.value, parsedRight.value);
      if (!merged.valid) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_intersection_types
        });
        return INVALID;
      }
      if (isDirty(parsedLeft) || isDirty(parsedRight)) {
        status.dirty();
      }
      return { status: status.value, value: merged.data };
    };
    if (ctx.common.async) {
      return Promise.all([
        this._def.left._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        }),
        this._def.right._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        })
      ]).then(([left, right]) => handleParsed(left, right));
    } else {
      return handleParsed(this._def.left._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }), this._def.right._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }));
    }
  }
};
ZodIntersection.create = (left, right, params) => {
  return new ZodIntersection({
    left,
    right,
    typeName: ZodFirstPartyTypeKind.ZodIntersection,
    ...processCreateParams(params)
  });
};
var ZodTuple = class _ZodTuple extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (ctx.data.length < this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_small,
        minimum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      return INVALID;
    }
    const rest = this._def.rest;
    if (!rest && ctx.data.length > this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_big,
        maximum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      status.dirty();
    }
    const items = [...ctx.data].map((item, itemIndex) => {
      const schema = this._def.items[itemIndex] || this._def.rest;
      if (!schema)
        return null;
      return schema._parse(new ParseInputLazyPath(ctx, item, ctx.path, itemIndex));
    }).filter((x) => !!x);
    if (ctx.common.async) {
      return Promise.all(items).then((results) => {
        return ParseStatus.mergeArray(status, results);
      });
    } else {
      return ParseStatus.mergeArray(status, items);
    }
  }
  get items() {
    return this._def.items;
  }
  rest(rest) {
    return new _ZodTuple({
      ...this._def,
      rest
    });
  }
};
ZodTuple.create = (schemas, params) => {
  if (!Array.isArray(schemas)) {
    throw new Error("You must pass an array of schemas to z.tuple([ ... ])");
  }
  return new ZodTuple({
    items: schemas,
    typeName: ZodFirstPartyTypeKind.ZodTuple,
    rest: null,
    ...processCreateParams(params)
  });
};
var ZodRecord = class _ZodRecord extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const pairs = [];
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    for (const key in ctx.data) {
      pairs.push({
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, key)),
        value: valueType._parse(new ParseInputLazyPath(ctx, ctx.data[key], ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (ctx.common.async) {
      return ParseStatus.mergeObjectAsync(status, pairs);
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get element() {
    return this._def.valueType;
  }
  static create(first, second, third) {
    if (second instanceof ZodType) {
      return new _ZodRecord({
        keyType: first,
        valueType: second,
        typeName: ZodFirstPartyTypeKind.ZodRecord,
        ...processCreateParams(third)
      });
    }
    return new _ZodRecord({
      keyType: ZodString.create(),
      valueType: first,
      typeName: ZodFirstPartyTypeKind.ZodRecord,
      ...processCreateParams(second)
    });
  }
};
var ZodMap = class extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.map) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.map,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    const pairs = [...ctx.data.entries()].map(([key, value], index) => {
      return {
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, [index, "key"])),
        value: valueType._parse(new ParseInputLazyPath(ctx, value, ctx.path, [index, "value"]))
      };
    });
    if (ctx.common.async) {
      const finalMap = /* @__PURE__ */ new Map();
      return Promise.resolve().then(async () => {
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          if (key.status === "aborted" || value.status === "aborted") {
            return INVALID;
          }
          if (key.status === "dirty" || value.status === "dirty") {
            status.dirty();
          }
          finalMap.set(key.value, value.value);
        }
        return { status: status.value, value: finalMap };
      });
    } else {
      const finalMap = /* @__PURE__ */ new Map();
      for (const pair of pairs) {
        const key = pair.key;
        const value = pair.value;
        if (key.status === "aborted" || value.status === "aborted") {
          return INVALID;
        }
        if (key.status === "dirty" || value.status === "dirty") {
          status.dirty();
        }
        finalMap.set(key.value, value.value);
      }
      return { status: status.value, value: finalMap };
    }
  }
};
ZodMap.create = (keyType, valueType, params) => {
  return new ZodMap({
    valueType,
    keyType,
    typeName: ZodFirstPartyTypeKind.ZodMap,
    ...processCreateParams(params)
  });
};
var ZodSet = class _ZodSet extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.set) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.set,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const def = this._def;
    if (def.minSize !== null) {
      if (ctx.data.size < def.minSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.minSize.message
        });
        status.dirty();
      }
    }
    if (def.maxSize !== null) {
      if (ctx.data.size > def.maxSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.maxSize.message
        });
        status.dirty();
      }
    }
    const valueType = this._def.valueType;
    function finalizeSet(elements2) {
      const parsedSet = /* @__PURE__ */ new Set();
      for (const element of elements2) {
        if (element.status === "aborted")
          return INVALID;
        if (element.status === "dirty")
          status.dirty();
        parsedSet.add(element.value);
      }
      return { status: status.value, value: parsedSet };
    }
    const elements = [...ctx.data.values()].map((item, i) => valueType._parse(new ParseInputLazyPath(ctx, item, ctx.path, i)));
    if (ctx.common.async) {
      return Promise.all(elements).then((elements2) => finalizeSet(elements2));
    } else {
      return finalizeSet(elements);
    }
  }
  min(minSize, message) {
    return new _ZodSet({
      ...this._def,
      minSize: { value: minSize, message: errorUtil.toString(message) }
    });
  }
  max(maxSize, message) {
    return new _ZodSet({
      ...this._def,
      maxSize: { value: maxSize, message: errorUtil.toString(message) }
    });
  }
  size(size, message) {
    return this.min(size, message).max(size, message);
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodSet.create = (valueType, params) => {
  return new ZodSet({
    valueType,
    minSize: null,
    maxSize: null,
    typeName: ZodFirstPartyTypeKind.ZodSet,
    ...processCreateParams(params)
  });
};
var ZodFunction = class _ZodFunction extends ZodType {
  constructor() {
    super(...arguments);
    this.validate = this.implement;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.function) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.function,
        received: ctx.parsedType
      });
      return INVALID;
    }
    function makeArgsIssue(args, error) {
      return makeIssue({
        data: args,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_arguments,
          argumentsError: error
        }
      });
    }
    function makeReturnsIssue(returns, error) {
      return makeIssue({
        data: returns,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_return_type,
          returnTypeError: error
        }
      });
    }
    const params = { errorMap: ctx.common.contextualErrorMap };
    const fn = ctx.data;
    if (this._def.returns instanceof ZodPromise) {
      const me = this;
      return OK(async function(...args) {
        const error = new ZodError([]);
        const parsedArgs = await me._def.args.parseAsync(args, params).catch((e) => {
          error.addIssue(makeArgsIssue(args, e));
          throw error;
        });
        const result = await Reflect.apply(fn, this, parsedArgs);
        const parsedReturns = await me._def.returns._def.type.parseAsync(result, params).catch((e) => {
          error.addIssue(makeReturnsIssue(result, e));
          throw error;
        });
        return parsedReturns;
      });
    } else {
      const me = this;
      return OK(function(...args) {
        const parsedArgs = me._def.args.safeParse(args, params);
        if (!parsedArgs.success) {
          throw new ZodError([makeArgsIssue(args, parsedArgs.error)]);
        }
        const result = Reflect.apply(fn, this, parsedArgs.data);
        const parsedReturns = me._def.returns.safeParse(result, params);
        if (!parsedReturns.success) {
          throw new ZodError([makeReturnsIssue(result, parsedReturns.error)]);
        }
        return parsedReturns.data;
      });
    }
  }
  parameters() {
    return this._def.args;
  }
  returnType() {
    return this._def.returns;
  }
  args(...items) {
    return new _ZodFunction({
      ...this._def,
      args: ZodTuple.create(items).rest(ZodUnknown.create())
    });
  }
  returns(returnType) {
    return new _ZodFunction({
      ...this._def,
      returns: returnType
    });
  }
  implement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  strictImplement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  static create(args, returns, params) {
    return new _ZodFunction({
      args: args ? args : ZodTuple.create([]).rest(ZodUnknown.create()),
      returns: returns || ZodUnknown.create(),
      typeName: ZodFirstPartyTypeKind.ZodFunction,
      ...processCreateParams(params)
    });
  }
};
var ZodLazy = class extends ZodType {
  get schema() {
    return this._def.getter();
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const lazySchema = this._def.getter();
    return lazySchema._parse({ data: ctx.data, path: ctx.path, parent: ctx });
  }
};
ZodLazy.create = (getter, params) => {
  return new ZodLazy({
    getter,
    typeName: ZodFirstPartyTypeKind.ZodLazy,
    ...processCreateParams(params)
  });
};
var ZodLiteral = class extends ZodType {
  _parse(input) {
    if (input.data !== this._def.value) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_literal,
        expected: this._def.value
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
  get value() {
    return this._def.value;
  }
};
ZodLiteral.create = (value, params) => {
  return new ZodLiteral({
    value,
    typeName: ZodFirstPartyTypeKind.ZodLiteral,
    ...processCreateParams(params)
  });
};
function createZodEnum(values, params) {
  return new ZodEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodEnum,
    ...processCreateParams(params)
  });
}
var ZodEnum = class _ZodEnum extends ZodType {
  _parse(input) {
    if (typeof input.data !== "string") {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(this._def.values);
    }
    if (!this._cache.has(input.data)) {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get options() {
    return this._def.values;
  }
  get enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Values() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  extract(values, newDef = this._def) {
    return _ZodEnum.create(values, {
      ...this._def,
      ...newDef
    });
  }
  exclude(values, newDef = this._def) {
    return _ZodEnum.create(this.options.filter((opt) => !values.includes(opt)), {
      ...this._def,
      ...newDef
    });
  }
};
ZodEnum.create = createZodEnum;
var ZodNativeEnum = class extends ZodType {
  _parse(input) {
    const nativeEnumValues = util.getValidEnumValues(this._def.values);
    const ctx = this._getOrReturnCtx(input);
    if (ctx.parsedType !== ZodParsedType.string && ctx.parsedType !== ZodParsedType.number) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(util.getValidEnumValues(this._def.values));
    }
    if (!this._cache.has(input.data)) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get enum() {
    return this._def.values;
  }
};
ZodNativeEnum.create = (values, params) => {
  return new ZodNativeEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodNativeEnum,
    ...processCreateParams(params)
  });
};
var ZodPromise = class extends ZodType {
  unwrap() {
    return this._def.type;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.promise && ctx.common.async === false) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.promise,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const promisified = ctx.parsedType === ZodParsedType.promise ? ctx.data : Promise.resolve(ctx.data);
    return OK(promisified.then((data) => {
      return this._def.type.parseAsync(data, {
        path: ctx.path,
        errorMap: ctx.common.contextualErrorMap
      });
    }));
  }
};
ZodPromise.create = (schema, params) => {
  return new ZodPromise({
    type: schema,
    typeName: ZodFirstPartyTypeKind.ZodPromise,
    ...processCreateParams(params)
  });
};
var ZodEffects = class extends ZodType {
  innerType() {
    return this._def.schema;
  }
  sourceType() {
    return this._def.schema._def.typeName === ZodFirstPartyTypeKind.ZodEffects ? this._def.schema.sourceType() : this._def.schema;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const effect = this._def.effect || null;
    const checkCtx = {
      addIssue: (arg) => {
        addIssueToContext(ctx, arg);
        if (arg.fatal) {
          status.abort();
        } else {
          status.dirty();
        }
      },
      get path() {
        return ctx.path;
      }
    };
    checkCtx.addIssue = checkCtx.addIssue.bind(checkCtx);
    if (effect.type === "preprocess") {
      const processed = effect.transform(ctx.data, checkCtx);
      if (ctx.common.async) {
        return Promise.resolve(processed).then(async (processed2) => {
          if (status.value === "aborted")
            return INVALID;
          const result = await this._def.schema._parseAsync({
            data: processed2,
            path: ctx.path,
            parent: ctx
          });
          if (result.status === "aborted")
            return INVALID;
          if (result.status === "dirty")
            return DIRTY(result.value);
          if (status.value === "dirty")
            return DIRTY(result.value);
          return result;
        });
      } else {
        if (status.value === "aborted")
          return INVALID;
        const result = this._def.schema._parseSync({
          data: processed,
          path: ctx.path,
          parent: ctx
        });
        if (result.status === "aborted")
          return INVALID;
        if (result.status === "dirty")
          return DIRTY(result.value);
        if (status.value === "dirty")
          return DIRTY(result.value);
        return result;
      }
    }
    if (effect.type === "refinement") {
      const executeRefinement = (acc) => {
        const result = effect.refinement(acc, checkCtx);
        if (ctx.common.async) {
          return Promise.resolve(result);
        }
        if (result instanceof Promise) {
          throw new Error("Async refinement encountered during synchronous parse operation. Use .parseAsync instead.");
        }
        return acc;
      };
      if (ctx.common.async === false) {
        const inner = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inner.status === "aborted")
          return INVALID;
        if (inner.status === "dirty")
          status.dirty();
        executeRefinement(inner.value);
        return { status: status.value, value: inner.value };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((inner) => {
          if (inner.status === "aborted")
            return INVALID;
          if (inner.status === "dirty")
            status.dirty();
          return executeRefinement(inner.value).then(() => {
            return { status: status.value, value: inner.value };
          });
        });
      }
    }
    if (effect.type === "transform") {
      if (ctx.common.async === false) {
        const base = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (!isValid(base))
          return INVALID;
        const result = effect.transform(base.value, checkCtx);
        if (result instanceof Promise) {
          throw new Error(`Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.`);
        }
        return { status: status.value, value: result };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((base) => {
          if (!isValid(base))
            return INVALID;
          return Promise.resolve(effect.transform(base.value, checkCtx)).then((result) => ({
            status: status.value,
            value: result
          }));
        });
      }
    }
    util.assertNever(effect);
  }
};
ZodEffects.create = (schema, effect, params) => {
  return new ZodEffects({
    schema,
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    effect,
    ...processCreateParams(params)
  });
};
ZodEffects.createWithPreprocess = (preprocess, schema, params) => {
  return new ZodEffects({
    schema,
    effect: { type: "preprocess", transform: preprocess },
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    ...processCreateParams(params)
  });
};
var ZodOptional = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.undefined) {
      return OK(void 0);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodOptional.create = (type, params) => {
  return new ZodOptional({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodOptional,
    ...processCreateParams(params)
  });
};
var ZodNullable = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.null) {
      return OK(null);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodNullable.create = (type, params) => {
  return new ZodNullable({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodNullable,
    ...processCreateParams(params)
  });
};
var ZodDefault = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    let data = ctx.data;
    if (ctx.parsedType === ZodParsedType.undefined) {
      data = this._def.defaultValue();
    }
    return this._def.innerType._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  removeDefault() {
    return this._def.innerType;
  }
};
ZodDefault.create = (type, params) => {
  return new ZodDefault({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodDefault,
    defaultValue: typeof params.default === "function" ? params.default : () => params.default,
    ...processCreateParams(params)
  });
};
var ZodCatch = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const newCtx = {
      ...ctx,
      common: {
        ...ctx.common,
        issues: []
      }
    };
    const result = this._def.innerType._parse({
      data: newCtx.data,
      path: newCtx.path,
      parent: {
        ...newCtx
      }
    });
    if (isAsync(result)) {
      return result.then((result2) => {
        return {
          status: "valid",
          value: result2.status === "valid" ? result2.value : this._def.catchValue({
            get error() {
              return new ZodError(newCtx.common.issues);
            },
            input: newCtx.data
          })
        };
      });
    } else {
      return {
        status: "valid",
        value: result.status === "valid" ? result.value : this._def.catchValue({
          get error() {
            return new ZodError(newCtx.common.issues);
          },
          input: newCtx.data
        })
      };
    }
  }
  removeCatch() {
    return this._def.innerType;
  }
};
ZodCatch.create = (type, params) => {
  return new ZodCatch({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodCatch,
    catchValue: typeof params.catch === "function" ? params.catch : () => params.catch,
    ...processCreateParams(params)
  });
};
var ZodNaN = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.nan) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.nan,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
};
ZodNaN.create = (params) => {
  return new ZodNaN({
    typeName: ZodFirstPartyTypeKind.ZodNaN,
    ...processCreateParams(params)
  });
};
var BRAND = Symbol("zod_brand");
var ZodBranded = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const data = ctx.data;
    return this._def.type._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  unwrap() {
    return this._def.type;
  }
};
var ZodPipeline = class _ZodPipeline extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.common.async) {
      const handleAsync = async () => {
        const inResult = await this._def.in._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inResult.status === "aborted")
          return INVALID;
        if (inResult.status === "dirty") {
          status.dirty();
          return DIRTY(inResult.value);
        } else {
          return this._def.out._parseAsync({
            data: inResult.value,
            path: ctx.path,
            parent: ctx
          });
        }
      };
      return handleAsync();
    } else {
      const inResult = this._def.in._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
      if (inResult.status === "aborted")
        return INVALID;
      if (inResult.status === "dirty") {
        status.dirty();
        return {
          status: "dirty",
          value: inResult.value
        };
      } else {
        return this._def.out._parseSync({
          data: inResult.value,
          path: ctx.path,
          parent: ctx
        });
      }
    }
  }
  static create(a, b) {
    return new _ZodPipeline({
      in: a,
      out: b,
      typeName: ZodFirstPartyTypeKind.ZodPipeline
    });
  }
};
var ZodReadonly = class extends ZodType {
  _parse(input) {
    const result = this._def.innerType._parse(input);
    const freeze = (data) => {
      if (isValid(data)) {
        data.value = Object.freeze(data.value);
      }
      return data;
    };
    return isAsync(result) ? result.then((data) => freeze(data)) : freeze(result);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodReadonly.create = (type, params) => {
  return new ZodReadonly({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodReadonly,
    ...processCreateParams(params)
  });
};
function cleanParams(params, data) {
  const p = typeof params === "function" ? params(data) : typeof params === "string" ? { message: params } : params;
  const p2 = typeof p === "string" ? { message: p } : p;
  return p2;
}
function custom(check, _params = {}, fatal) {
  if (check)
    return ZodAny.create().superRefine((data, ctx) => {
      const r2 = check(data);
      if (r2 instanceof Promise) {
        return r2.then((r3) => {
          if (!r3) {
            const params = cleanParams(_params, data);
            const _fatal = params.fatal ?? fatal ?? true;
            ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
          }
        });
      }
      if (!r2) {
        const params = cleanParams(_params, data);
        const _fatal = params.fatal ?? fatal ?? true;
        ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
      }
      return;
    });
  return ZodAny.create();
}
var late = {
  object: ZodObject.lazycreate
};
var ZodFirstPartyTypeKind;
(function(ZodFirstPartyTypeKind2) {
  ZodFirstPartyTypeKind2["ZodString"] = "ZodString";
  ZodFirstPartyTypeKind2["ZodNumber"] = "ZodNumber";
  ZodFirstPartyTypeKind2["ZodNaN"] = "ZodNaN";
  ZodFirstPartyTypeKind2["ZodBigInt"] = "ZodBigInt";
  ZodFirstPartyTypeKind2["ZodBoolean"] = "ZodBoolean";
  ZodFirstPartyTypeKind2["ZodDate"] = "ZodDate";
  ZodFirstPartyTypeKind2["ZodSymbol"] = "ZodSymbol";
  ZodFirstPartyTypeKind2["ZodUndefined"] = "ZodUndefined";
  ZodFirstPartyTypeKind2["ZodNull"] = "ZodNull";
  ZodFirstPartyTypeKind2["ZodAny"] = "ZodAny";
  ZodFirstPartyTypeKind2["ZodUnknown"] = "ZodUnknown";
  ZodFirstPartyTypeKind2["ZodNever"] = "ZodNever";
  ZodFirstPartyTypeKind2["ZodVoid"] = "ZodVoid";
  ZodFirstPartyTypeKind2["ZodArray"] = "ZodArray";
  ZodFirstPartyTypeKind2["ZodObject"] = "ZodObject";
  ZodFirstPartyTypeKind2["ZodUnion"] = "ZodUnion";
  ZodFirstPartyTypeKind2["ZodDiscriminatedUnion"] = "ZodDiscriminatedUnion";
  ZodFirstPartyTypeKind2["ZodIntersection"] = "ZodIntersection";
  ZodFirstPartyTypeKind2["ZodTuple"] = "ZodTuple";
  ZodFirstPartyTypeKind2["ZodRecord"] = "ZodRecord";
  ZodFirstPartyTypeKind2["ZodMap"] = "ZodMap";
  ZodFirstPartyTypeKind2["ZodSet"] = "ZodSet";
  ZodFirstPartyTypeKind2["ZodFunction"] = "ZodFunction";
  ZodFirstPartyTypeKind2["ZodLazy"] = "ZodLazy";
  ZodFirstPartyTypeKind2["ZodLiteral"] = "ZodLiteral";
  ZodFirstPartyTypeKind2["ZodEnum"] = "ZodEnum";
  ZodFirstPartyTypeKind2["ZodEffects"] = "ZodEffects";
  ZodFirstPartyTypeKind2["ZodNativeEnum"] = "ZodNativeEnum";
  ZodFirstPartyTypeKind2["ZodOptional"] = "ZodOptional";
  ZodFirstPartyTypeKind2["ZodNullable"] = "ZodNullable";
  ZodFirstPartyTypeKind2["ZodDefault"] = "ZodDefault";
  ZodFirstPartyTypeKind2["ZodCatch"] = "ZodCatch";
  ZodFirstPartyTypeKind2["ZodPromise"] = "ZodPromise";
  ZodFirstPartyTypeKind2["ZodBranded"] = "ZodBranded";
  ZodFirstPartyTypeKind2["ZodPipeline"] = "ZodPipeline";
  ZodFirstPartyTypeKind2["ZodReadonly"] = "ZodReadonly";
})(ZodFirstPartyTypeKind || (ZodFirstPartyTypeKind = {}));
var instanceOfType = (cls, params = {
  message: `Input not instance of ${cls.name}`
}) => custom((data) => data instanceof cls, params);
var stringType = ZodString.create;
var numberType = ZodNumber.create;
var nanType = ZodNaN.create;
var bigIntType = ZodBigInt.create;
var booleanType = ZodBoolean.create;
var dateType = ZodDate.create;
var symbolType = ZodSymbol.create;
var undefinedType = ZodUndefined.create;
var nullType = ZodNull.create;
var anyType = ZodAny.create;
var unknownType = ZodUnknown.create;
var neverType = ZodNever.create;
var voidType = ZodVoid.create;
var arrayType = ZodArray.create;
var objectType = ZodObject.create;
var strictObjectType = ZodObject.strictCreate;
var unionType = ZodUnion.create;
var discriminatedUnionType = ZodDiscriminatedUnion.create;
var intersectionType = ZodIntersection.create;
var tupleType = ZodTuple.create;
var recordType = ZodRecord.create;
var mapType = ZodMap.create;
var setType = ZodSet.create;
var functionType = ZodFunction.create;
var lazyType = ZodLazy.create;
var literalType = ZodLiteral.create;
var enumType = ZodEnum.create;
var nativeEnumType = ZodNativeEnum.create;
var promiseType = ZodPromise.create;
var effectsType = ZodEffects.create;
var optionalType = ZodOptional.create;
var nullableType = ZodNullable.create;
var preprocessType = ZodEffects.createWithPreprocess;
var pipelineType = ZodPipeline.create;
var ostring = () => stringType().optional();
var onumber = () => numberType().optional();
var oboolean = () => booleanType().optional();
var coerce = {
  string: (arg) => ZodString.create({ ...arg, coerce: true }),
  number: (arg) => ZodNumber.create({ ...arg, coerce: true }),
  boolean: (arg) => ZodBoolean.create({
    ...arg,
    coerce: true
  }),
  bigint: (arg) => ZodBigInt.create({ ...arg, coerce: true }),
  date: (arg) => ZodDate.create({ ...arg, coerce: true })
};
var NEVER = INVALID;

// src/lib/ids.ts
var PLAN_ID_RE = /^[A-Za-z0-9_.-]{1,64}$/;
var isPlanId = (s2) => PLAN_ID_RE.test(s2) && s2 !== "." && s2 !== "..";

// src/lib/plan.ts
var id = external_exports.string().regex(PLAN_ID_RE, "invalid id (allowed: letters, digits, _ - .; max 64)").refine((s2) => s2 !== "." && s2 !== "..", "invalid id");
var TaskSchema = external_exports.object({
  id,
  title: external_exports.string().min(1),
  track: id,
  phase: id,
  category: external_exports.string().optional(),
  includes: external_exports.string().optional(),
  done_when: external_exports.string().min(1),
  verification: external_exports.string().optional(),
  depends_on: external_exports.array(id).default([]),
  zones: external_exports.array(external_exports.string().min(1)).default([]),
  estimate_min: external_exports.number().positive().optional()
});
var PlanSchema = external_exports.object({
  project: id,
  locale: external_exports.string().min(1).default("en"),
  version: external_exports.string().min(1),
  artifacts: external_exports.object({ roadmap: external_exports.string().url().optional(), design: external_exports.string().url().optional() }).default({}),
  versions: external_exports.array(external_exports.object({ id, phases: external_exports.array(id) })).default([]),
  tracks: external_exports.array(external_exports.object({ id, name: external_exports.string().min(1), color: external_exports.enum(TRACK_COLORS) })).min(1),
  phases: external_exports.array(external_exports.object({
    id,
    name: external_exports.string().min(1),
    plan_status: external_exports.enum(["committed", "provisional"]).default("committed")
  })).min(1),
  tasks: external_exports.array(TaskSchema).min(1)
});
var PlanError = class extends Error {
  constructor(issues) {
    super(`Invalid plan:
- ${issues.join("\n- ")}`);
    this.issues = issues;
    this.name = "PlanError";
  }
};
function parsePlan(text) {
  let raw;
  try {
    raw = (0, import_yaml.parse)(text);
  } catch (e) {
    throw new PlanError([`YAML: ${e.message}`]);
  }
  const r2 = PlanSchema.safeParse(raw);
  if (!r2.success) throw new PlanError(r2.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`));
  const plan = r2.data;
  const issues = checkReferences(plan);
  if (issues.length) throw new PlanError(issues);
  return plan;
}
function dupes(ids) {
  const seen = /* @__PURE__ */ new Set();
  const out = /* @__PURE__ */ new Set();
  for (const i of ids) (seen.has(i) ? out : seen).add(i);
  return [...out];
}
function checkReferences(plan) {
  const issues = [];
  const lists = [["track", plan.tracks], ["phase", plan.phases], ["task", plan.tasks], ["version", plan.versions]];
  for (const [kind, list] of lists) for (const d of dupes(list.map((x) => x.id))) issues.push(`duplicate ${kind} id: ${d}`);
  const tracks = new Set(plan.tracks.map((t) => t.id));
  const phases = new Set(plan.phases.map((p) => p.id));
  const tasks = new Set(plan.tasks.map((t) => t.id));
  for (const t of plan.tasks) {
    if (!tracks.has(t.track)) issues.push(`task ${t.id}: unknown track ${t.track}`);
    if (!phases.has(t.phase)) issues.push(`task ${t.id}: unknown phase ${t.phase}`);
    for (const d of t.depends_on) if (!tasks.has(d)) issues.push(`task ${t.id}: unknown dependency ${d}`);
  }
  for (const v of plan.versions) for (const p of v.phases) if (!phases.has(p)) issues.push(`version ${v.id}: unknown phase ${p}`);
  const cycle = findCycle(plan);
  if (cycle) issues.push(`dependency cycle: ${cycle.join(" -> ")}`);
  return issues;
}
function findCycle(plan) {
  const deps = new Map(plan.tasks.map((t) => [t.id, t.depends_on]));
  const mark = /* @__PURE__ */ new Map();
  const stack = [];
  const visit = (n) => {
    if (mark.get(n) === 2) return null;
    if (mark.get(n) === 1) return [...stack.slice(stack.indexOf(n)), n];
    mark.set(n, 1);
    stack.push(n);
    for (const d of deps.get(n) ?? []) {
      const c = visit(d);
      if (c) return c;
    }
    stack.pop();
    mark.set(n, 2);
    return null;
  };
  for (const t of plan.tasks) {
    const c = visit(t.id);
    if (c) return c;
  }
  return null;
}

// src/lib/execution-state.ts
var SAFE_ID = /^[A-Za-z0-9_\-.]{1,120}$/;
var isSafeId = (s2) => typeof s2 === "string" && SAFE_ID.test(s2) && s2 !== "." && s2 !== "..";
var RUN_BRANCH = /^[A-Za-z0-9_./][A-Za-z0-9_\-./]{0,119}$/;
var isRunBranch = (s2) => typeof s2 === "string" && RUN_BRANCH.test(s2) && !s2.includes("..");
var TASK_STATUSES = ["running", "accepted", "integrated", "conflict", "blocked"];
var STOPS = ["finished", "stalled", "stopped", "budget", "migrated"];
var MAX_TASKS = 500;
var isObj3 = (x) => !!x && typeof x === "object" && !Array.isArray(x);
var str3 = (x) => typeof x === "string" && x ? x : null;
var iso2 = (x) => typeof x === "string" && !Number.isNaN(Date.parse(x)) ? x : null;
var FUTURE_SKEW_MS = 12e4;
var finishedOf = (x, now) => {
  const v = iso2(x);
  if (!v) return null;
  return now !== void 0 && Number.isFinite(now) && Date.parse(v) - now > FUTURE_SKEW_MS ? null : v;
};
var int = (x, min, max, dflt) => typeof x === "number" && Number.isInteger(x) ? Math.min(max, Math.max(min, x)) : dflt;
var oneOf2 = (list, x) => list.includes(x) ? x : null;
var cleanTitle = (x) => typeof x === "string" ? x.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim().slice(0, 200) : "";
function normalizeTask(x, now) {
  if (!isObj3(x)) return null;
  const status = oneOf2(TASK_STATUSES, x.status);
  const stage = oneOf2(STAGES, x.stage);
  const executor = oneOf2(["subagents", "sessions", "manual"], x.executor);
  const worktree = typeof x.worktree === "string" ? x.worktree : null;
  const branch = str3(x.branch);
  const startedAt = iso2(x.startedAt);
  if (!status || !stage || !executor || worktree === null || !branch || !startedAt) return null;
  const title = cleanTitle(x.title);
  return {
    status,
    stage,
    executor,
    worktree,
    branch,
    startedAt,
    stageSince: iso2(x.stageSince) ?? startedAt,
    round: int(x.round, 0, 99, 0),
    attempts: int(x.attempts, 0, 99, 0),
    agent: str3(x.agent),
    updatedAt: iso2(x.updatedAt) ?? startedAt,
    detail: typeof x.detail === "string" ? x.detail.slice(0, 500) : null,
    ...iso2(x.nudgedAt) ? { nudgedAt: iso2(x.nudgedAt) } : {},
    ...finishedOf(x.finishedAt, now) ? { finishedAt: finishedOf(x.finishedAt, now) } : {},
    ...title ? { title } : {}
  };
}
function normalizeExecution(x, now) {
  if (!isObj3(x)) return null;
  const mode = oneOf2(["subagents", "sessions"], x.mode);
  const kind = oneOf2(["plan", "ephemeral"], x.kind) ?? "plan";
  const runId = str3(x.runId), project = str3(x.project), base = str3(x.base), branch = str3(x.branch), coordinator = str3(x.coordinator);
  const startedAt = iso2(x.startedAt);
  if (!mode || !runId || !project || !base || !branch || !coordinator || !startedAt) return null;
  if (!isSafeId(runId) || !isSafeId(coordinator) || !isRunBranch(branch)) return null;
  const tasks = {};
  if (isObj3(x.tasks)) {
    for (const [id2, t] of Object.entries(x.tasks).slice(0, MAX_TASKS)) {
      const n = isPlanId(id2) ? normalizeTask(t, now) : null;
      if (n) tasks[id2] = n;
    }
  }
  return {
    runId,
    kind,
    mode,
    project,
    base,
    branch,
    coordinator,
    startedAt,
    tasks,
    parallel: int(x.parallel, 1, 10, 3),
    mergeOnFinish: x.mergeOnFinish === true,
    hookSession: isSafeId(x.hookSession) ? x.hookSession : null,
    active: x.active === true,
    stopReason: oneOf2(STOPS, x.stopReason),
    stallReason: typeof x.stallReason === "string" ? x.stallReason.slice(0, 1e3) : null,
    lastStepAt: iso2(x.lastStepAt),
    lastBlockStep: iso2(x.lastBlockStep),
    sleepUntil: iso2(x.sleepUntil),
    ...typeof x.planned === "number" && Number.isInteger(x.planned) ? { planned: Math.min(MAX_TASKS, Math.max(0, x.planned)) } : {}
  };
}
function parseExecution(text, now) {
  if (typeof text !== "string") return null;
  try {
    return normalizeExecution(JSON.parse(text), now);
  } catch {
    return null;
  }
}
function fromSwarm(s2) {
  return {
    runId: `swarm-${s2.startedAt.replace(/[:.]/g, "")}`,
    kind: "plan",
    mode: "sessions",
    parallel: Math.min(10, Math.max(1, s2.parallel)),
    project: s2.project,
    base: s2.base,
    branch: s2.base,
    mergeOnFinish: s2.mergeAuthorized,
    coordinator: s2.coordinator,
    hookSession: s2.hookSession,
    active: false,
    stopReason: "migrated",
    stallReason: null,
    startedAt: s2.startedAt,
    lastStepAt: s2.lastTickAt,
    lastBlockStep: null,
    sleepUntil: null,
    tasks: {}
  };
}
function normalizePublicTask(x) {
  if (!isObj3(x)) return null;
  const task = str3(x.task), runId = str3(x.runId), by = str3(x.by);
  const stage = oneOf2(STAGES, x.stage), status = oneOf2(TASK_STATUSES, x.status), mode = oneOf2(["subagents", "sessions", "manual"], x.mode);
  const since = iso2(x.since), updatedAt = iso2(x.updatedAt), leaseUntil = iso2(x.leaseUntil);
  if (!task || !isPlanId(task) || !runId || !by || !stage || !status || !mode || !since || !updatedAt || !leaseUntil) return null;
  return { task, runId, stage, status, mode, by, since, updatedAt, leaseUntil, agent: str3(x.agent), round: int(x.round, 0, 99, 0) };
}
var LIVE_SILENT_MINUTES = 7;
var LIVE_STOPPED_MINUTES = 12;
function normalizeLive(x) {
  if (!isObj3(x)) return null;
  const sessionId = str3(x.sessionId), ts = iso2(x.ts);
  const role = oneOf2(["coordinator", "executor", "manual"], x.role);
  if (!sessionId || !ts || !role) return null;
  const agents = Array.isArray(x.agents) ? x.agents.filter(isObj3).map((a) => ({ id: str3(a.id), type: str3(a.type) ?? "", since: iso2(a.since) })).filter((a) => !!a.id && !!a.since).slice(0, 20) : [];
  return { sessionId, role, ts, agents, runId: str3(x.runId), task: str3(x.task), event: (str3(x.event) ?? "").slice(0, 40), ended: x.ended === true };
}

// src/forge/execution.ts
var executionFile = (root) => import_node_path4.default.join(root, ".forge", "execution.json");
var executionTaskFile = (root, task) => import_node_path4.default.join(root, ".forge", "execution", `${task}.json`);
var runBranch = (project) => `forge/run-${project}`;
var taskBranch = (task) => `task/${task}`;
var runWorktree = (root) => import_node_path4.default.join(root, ".claude", "worktrees", "run");
var taskWorktree = (root, task) => import_node_path4.default.join(root, ".claude", "worktrees", `task-${task}`);
function writeAtomic(file, text) {
  (0, import_node_fs4.mkdirSync)(import_node_path4.default.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    (0, import_node_fs4.writeFileSync)(tmp, text);
    (0, import_node_fs4.renameSync)(tmp, file);
  } finally {
    (0, import_node_fs4.rmSync)(tmp, { force: true });
  }
}
function saveExecution(root, e) {
  forgeDir(root);
  writeAtomic(executionFile(root), JSON.stringify(e, null, 2) + "\n");
}
function readExecution(root) {
  const file = executionFile(root);
  if ((0, import_node_fs4.existsSync)(file)) {
    try {
      return parseExecution((0, import_node_fs4.readFileSync)(file, "utf8"));
    } catch {
      return null;
    }
  }
  const old = readSwarm(root);
  if (!old) return null;
  const migrated = fromSwarm(old);
  saveExecution(root, migrated);
  (0, import_node_fs4.renameSync)(swarmFile(root), `${swarmFile(root)}.migrated`);
  return migrated;
}
function writePublicTask(root, p) {
  writeAtomic(executionTaskFile(root, p.task), JSON.stringify(p, null, 2) + "\n");
}

// src/lib/locale.ts
var import_node_fs5 = require("node:fs");
var import_node_path5 = __toESM(require("node:path"), 1);
var NAMES = {
  es: "Spanish",
  en: "English",
  pt: "Portuguese",
  fr: "French",
  de: "German",
  it: "Italian",
  ca: "Catalan",
  gl: "Galician",
  eu: "Basque"
};
function replyIn(locale) {
  const code = (locale ?? "").toLowerCase().split(/[-_]/)[0];
  if (!code) return " Tell the user in their own language.";
  const name = NAMES[code];
  return ` Tell the user in ${name ? `${name} (${code})` : `the language \xAB${code}\xBB`}, the plan's language.`;
}
function planLocale(root, project) {
  try {
    const docs = import_node_path5.default.join(root, "docs", "waypoint");
    const projects = project ? [project] : (0, import_node_fs5.readdirSync)(docs, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    for (const p of projects) {
      const file = import_node_path5.default.join(docs, p, "plan.yaml");
      if ((0, import_node_fs5.existsSync)(file)) return parsePlan((0, import_node_fs5.readFileSync)(file, "utf8")).locale ?? null;
    }
  } catch {
  }
  return null;
}

// src/forge/triage.ts
var PATH_ORDER = ["trivial", "small", "medium", "large"];
var MAX_FILES = 200;
var MAX_PER_SYMBOL = 50;
var MAX_SYMBOLS = 20;
var MAX_TEXT = 2e4;
var es = (stems, words2) => new RegExp(`(?<![\\p{L}\\p{N}_])(?:(?:${stems})\\p{L}*|(?:${words2})(?![\\p{L}\\p{N}_]))`, "iu");
var ZONES = [
  { zone: "auth", text: [/\b(auth\w*|login|logout|passwords?|passwd|tokens?|jwt|oauth|sessions?|permissions?|crypto|secrets?)\b/i, es("autentic|contrase\xF1|permis|secret", "sesi[o\xF3]n|sesiones")], path: /(^|\/)(auth|security|crypto)(\/|\.)/i },
  { zone: "data", text: [/\b(migrations?|schema|database|sql|prisma|orm)\b/i, es("migraci", "bases? de datos|esquemas?")], path: /(^|\/)(migrations?|db|schema)(\/|\.)|\.sql$/i },
  { zone: "public-api", text: [/\b(public api|endpoints?|openapi|swagger|graphql)\b/i, es("endpoint", "apis? p[u\xFA]blicas?")], path: /(^|\/)(api|routes)\//i },
  { zone: "deps", text: [/\b(dependenc(y|ies)|upgrade|npm install|pip install)\b/i, es("dependencia", "actualizar? dependencias")], path: /(^|\/)(package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|requirements[^/]*\.txt|pyproject\.toml|Cargo\.(toml|lock)|go\.(mod|sum))$/i },
  { zone: "ci", text: [/\b(ci|pipelines?|workflows?|deploy\w*|release)\b/i, es("despliegue", "integraci[o\xF3]n continua")], path: /(^|\/)(\.github\/workflows|\.gitlab-ci|\.circleci)/i }
];
var ZONE_ORDER = ZONES.map((z) => z.zone);
function zonesFromPaths(paths) {
  return ZONES.filter((z) => paths.some((p) => z.path.test(p))).map((z) => z.zone);
}
var LARGE = [
  /\b(architecture|redesign|rewrite|subsystem|new (project|app|service|system)|from scratch|migrat(e|ion) (to|from))\b/i,
  es("arquitect|redise\xF1|reescrib|reescritur|subsistem", "desde cero|(?:nuev[oa]|otr[oa]) (?:proyecto|aplicaci[o\xF3]n|app|servicio|sistema)|migr(?:ar|aci[o\xF3]n) (?:a|al|desde)")
];
var RENAME = [/\brenam/i, /(?<![\p{L}\p{N}_])renombr/iu];
var MECHANICAL = [
  /\b(renam\w*|bump\w*|regenerat\w*|translat\w*|fixtures?|changelog)\b/i,
  /\bapply(?:ing)?\s+(?:the|this|that|these|a|an|given)?\s*patch(?:es)?\b/i,
  /\bmov(?:e|es|ed|ing)\s+(?:the\s+)?(?:files?|folders?|directory|directories|dirs?)\b|\bmov(?:e|es|ed|ing)\s+\S*[\w-]\.\w+\s+to\b|\bmov(?:e|es|ed|ing)\s+\S*\/\S*\s+to\b/i,
  /\b(?:fix(?:es|ing)?|correct\w*)\s+(?:the\s+|a\s+|some\s+)?typos?\b|\btypos?\s+fix/i,
  es("renombr|regener|traduc", "errata|erratas|fixtures?|changelog|sube la versi[o\xF3]n"),
  /(?<![\p{L}\p{N}_])aplic(?:a|ar|ando)\s+(?:el|este|ese|un|los|estos)\s+parches?(?![\p{L}\p{N}_])/iu,
  /(?<![\p{L}\p{N}_])(?:mueve|mover|muevo)\s+(?:los?\s+|las?\s+)?(?:archivos?|carpetas?|directorios?|\S*[\w-]\.\w+\s+a\b|\S*\/\S*\s+a\b)/iu
];
function isMechanical(text) {
  const t = String(text).slice(0, MAX_TEXT);
  return MECHANICAL.some((re) => re.test(t));
}
function implementerFor(r2, text, opts = {}) {
  switch (r2.path) {
    case "trivial":
      return opts.batch ? { role: "mech", self: false, why: "trivial in a batch: delegated, the session runs several at once" } : { role: null, self: true, why: "trivial: the session does it" };
    case "small":
      return isMechanical(text) ? { role: "mech", self: false, why: "small and mechanical: always delegated to mech" } : { role: "impl-light", self: false, why: "small and bounded: always delegated to impl-light" };
    case "medium":
      return r2.sensitive.length ? { role: "impl-heavy", self: false, why: `medium on a sensitive zone (${r2.sensitive.join(", ")})` } : { role: "impl", self: false, why: "medium" };
    default:
      return { role: null, self: false, why: "large: design and plan first" };
  }
}
var PATH_TOKEN = /[\w.\-/]*[\w-]\.[A-Za-z0-9]{1,8}\b|[\w.-]+\/[\w.\-/]+/g;
var isSymbol = (w) => w.length >= 4 && (/[a-z][A-Z]/.test(w) || /^[A-Za-z]+_[A-Za-z0-9_]+$/.test(w));
function triage(task, repo, validators, extra) {
  const reasons = [];
  const text = String(task).slice(0, MAX_TEXT);
  const files = new Set(extra?.files);
  const named = /* @__PURE__ */ new Set();
  for (const tok of text.match(PATH_TOKEN) ?? []) {
    const t = tok.replace(/^\.\//, "");
    for (const f of repo.files) if (f === t || f.endsWith(`/${t}`)) {
      files.add(f);
      named.add(f);
    }
  }
  const words2 = new Set([...text.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim()).filter((w) => /^[\w.$]{3,}$/.test(w)));
  for (const w of text.split(/[^A-Za-z0-9_]+/)) if (isSymbol(w)) words2.add(w);
  for (const w of [...words2].slice(0, MAX_SYMBOLS)) for (const f of repo.grep(w).slice(0, MAX_PER_SYMBOL)) files.add(f);
  const located = [...files].sort().slice(0, MAX_FILES);
  const sensitive = ZONES.filter((z) => z.text.some((re) => re.test(text)) || extra?.zones.includes(z.zone) || located.some((f) => z.path.test(f))).map((z) => z.zone);
  const greenfield = repo.gitOk && (repo.commits === 0 || repo.files.length < 5);
  if (!repo.gitOk) reasons.push("git unavailable");
  const wordCount = text.trim().split(/\s+/).length;
  const sized = named.size ? named.size : located.length;
  let path17;
  if (greenfield) {
    path17 = "large";
    reasons.push("greenfield repository");
  } else if (LARGE.some((re) => re.test(text))) {
    path17 = "large";
    reasons.push("architecture-scale wording");
  } else if (sized > 10) {
    path17 = "large";
    reasons.push(`${sized} files located`);
  } else if (sized > 3) {
    path17 = "medium";
    reasons.push(`${sized} files located`);
  } else if (sized === 0) {
    path17 = "small";
    reasons.push("no files located: the session should judge the scope");
  } else if (sized === 1 && wordCount <= 25 && !RENAME.some((re) => re.test(text))) {
    path17 = "trivial";
    reasons.push(named.size ? "one named file, short task" : "one file, short task");
  } else {
    path17 = "small";
    reasons.push(`${sized} file(s) located`);
  }
  if (sensitive.length && PATH_ORDER.indexOf(path17) < PATH_ORDER.indexOf("medium")) {
    path17 = "medium";
    reasons.push(`sensitive zone: ${sensitive.join(", ")}`);
  }
  return { path: path17, files: located, sensitive, greenfield, validators, reasons };
}

// src/forge/brief.ts
function taskText(task) {
  return [task.title, task.includes, task.done_when].filter((s2) => !!s2 && !!s2.trim()).map((s2) => s2.trim()).join(". ");
}
function renderBrief(plan, task, opts) {
  const lines = [
    `# ${task.id}: ${task.title}`,
    "",
    `Project: ${plan.project} \xB7 Track: ${task.track} \xB7 Phase: ${task.phase}`,
    ...task.includes ? [`Includes: ${task.includes}`] : [],
    `Done when: ${task.done_when}`,
    ...task.verification ? [`Verification: ${task.verification}`] : [],
    `Commit title prefix: ${task.id}: `,
    `Zones: ${task.zones.length ? task.zones.join(", ") : "(none listed)"}`,
    ...task.depends_on.length ? [`Depends on: ${task.depends_on.join(", ")}`] : [],
    ...task.estimate_min ? [`Estimate: ${task.estimate_min} min`] : [],
    "",
    `Plan: ${opts.planPath}`,
    ...opts.designPath ? [`Design: ${opts.designPath}`] : [],
    "",
    'Stay inside the zones where possible; the task is done only when "Done when" holds and the validators pass.'
  ];
  return lines.join("\n") + "\n";
}

// src/forge/config.ts
var import_node_fs6 = require("node:fs");
var import_node_path6 = __toESM(require("node:path"), 1);
var import_yaml2 = __toESM(require_dist(), 1);
var ROLES = ["impl-heavy", "impl", "impl-light", "mech", "review-correctness", "review-security", "review-perf", "verify"];
var NAME = /^[A-Za-z0-9_.:-]{1,64}$/;
var ConfigError = class extends Error {
};
var Schema = external_exports.object({
  profile: external_exports.enum(["balanced", "economy", "quality"]).default("balanced"),
  detect: external_exports.boolean().default(true),
  exclude: external_exports.array(external_exports.string().regex(NAME)).default([]),
  validators: external_exports.array(external_exports.object({
    name: external_exports.string().regex(NAME),
    cmd: external_exports.string().min(1),
    kind: external_exports.string().regex(NAME).optional(),
    affects: external_exports.array(external_exports.string().min(1)).optional(),
    when: external_exports.enum(["always", "medium", "final"]).optional()
  }).strict()).optional(),
  verify: external_exports.object({
    limits: external_exports.object({
      checks: external_exports.number().int().min(1).max(20).default(8),
      shots: external_exports.number().int().min(1).max(30).default(10),
      minutes: external_exports.number().int().min(1).max(60).default(10)
    }).strict().default({})
  }).strict().default({}),
  evidence: external_exports.enum(["upload", "local"]).default("upload"),
  validatorTimeoutSec: external_exports.number().int().positive().max(7200).default(600),
  swarm: external_exports.object({
    parallel: external_exports.number().int().min(1).max(10).default(3),
    mode: external_exports.enum(["subagents", "sessions"]).optional(),
    launcher: external_exports.enum(["bg", "herdr"]).default("bg"),
    setup: external_exports.string().min(1).max(500).optional()
  }).strict().default({ parallel: 3, launcher: "bg" })
}).strict();
var DEFAULTS = {
  profile: "balanced",
  detect: true,
  exclude: [],
  verify: { limits: { checks: 8, shots: 10, minutes: 10 } },
  evidence: "upload",
  validatorTimeoutSec: 600,
  swarm: { parallel: 3, launcher: "bg" }
};
function parseConfig(text) {
  if (text === null || !text.trim()) return structuredClone(DEFAULTS);
  let raw;
  try {
    raw = (0, import_yaml2.parse)(text);
  } catch (e) {
    throw new ConfigError(`.forge/config.yaml: ${e.message}`);
  }
  const r2 = Schema.safeParse(raw ?? {});
  if (!r2.success) throw new ConfigError(`.forge/config.yaml: ${r2.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
  const { validators, ...rest } = r2.data;
  return validators ? { ...rest, validators } : rest;
}
function loadConfig(root) {
  const file = import_node_path6.default.join(root, ".forge", "config.yaml");
  return parseConfig((0, import_node_fs6.existsSync)(file) ? (0, import_node_fs6.readFileSync)(file, "utf8") : null);
}
var SHIFT = {
  balanced: {},
  economy: { "impl-heavy": "forge-impl", impl: "forge-impl-light" },
  quality: { impl: "forge-impl-heavy", "impl-light": "forge-impl", mech: "forge-impl-light", verify: "forge-verify-heavy" }
};
function agentFor(role, profile) {
  return SHIFT[profile][role] ?? `forge-${role}`;
}

// src/forge/verdict.ts
var import_node_crypto = require("node:crypto");
var invalidReview = () => ({ verdict: "abstain", confidence: 0, findings: [], invalid: true });
var SEVERITIES = ["critical", "important", "minor"];
function num2(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v.trim()))) return Number(v.trim());
  return null;
}
function lineOf(v) {
  if (typeof v === "number") return Number.isInteger(v) && v >= 0 ? v : void 0;
  const m = typeof v === "string" ? /^\s*(\d+)/.exec(v) : null;
  return m ? Number(m[1]) : void 0;
}
function findingOf(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const f = v;
  if (typeof f.problem !== "string" || !f.problem.trim()) return null;
  const sev = typeof f.severity === "string" ? f.severity.trim().toLowerCase() : "";
  const out = { severity: SEVERITIES.includes(sev) ? sev : "important", problem: f.problem };
  if (typeof f.file === "string" && f.file.trim()) out.file = f.file;
  const line = lineOf(f.line);
  if (line !== void 0) out.line = line;
  if (typeof f.fix === "string") out.fix = f.fix;
  return out;
}
function parseReview(text) {
  if (!text) return invalidReview();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return invalidReview();
  let raw;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return invalidReview();
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return invalidReview();
  const r2 = raw;
  const verdict = typeof r2.verdict === "string" ? r2.verdict.trim().toLowerCase() : "";
  if (verdict !== "pass" && verdict !== "fail" && verdict !== "abstain") return invalidReview();
  const confidence = num2(r2.confidence);
  if (confidence === null || confidence < 0 || confidence > 1) return invalidReview();
  if (r2.findings !== void 0 && r2.findings !== null && !Array.isArray(r2.findings)) return invalidReview();
  const rawFindings = Array.isArray(r2.findings) ? r2.findings : [];
  const findings = rawFindings.map(findingOf).filter((f) => f !== null);
  const dropped = rawFindings.length - findings.length;
  const review = { verdict, confidence, findings };
  if (r2.approach === "ok" || r2.approach === "wrong") review.approach = r2.approach;
  if (dropped > 0) {
    review.dropped = dropped;
    review.invalid = true;
  }
  return review;
}
function weightsFor(opts) {
  if (opts.sensitive && opts.perf) return { correctness: 0.2, security: 0.4, perf: 0.4, verify: 0.2 };
  if (opts.sensitive) return { correctness: 0.3, security: 0.5, perf: 0.2, verify: 0.3 };
  if (opts.perf) return { correctness: 0.3, security: 0.2, perf: 0.5, verify: 0.3 };
  return { correctness: 0.5, security: 0.3, perf: 0.2, verify: 0.5 };
}
var s = (v) => typeof v === "string" ? v : v == null ? "" : String(v);
var truthy = (v) => v === true || typeof v === "string" && v.trim().toLowerCase() === "true";
function parseVerifyFile(text) {
  if (!text) return null;
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  let raw;
  try {
    raw = JSON.parse(text.slice(a, b + 1));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r2 = raw;
  const result = s(r2.result).trim().toLowerCase();
  if (result !== "pass" && result !== "fail" && result !== "blocked") return null;
  if (!Array.isArray(r2.checks)) return null;
  const reason = typeof r2.reason === "string" && r2.reason.trim() ? r2.reason : null;
  if (result === "blocked" && !reason) return null;
  const objs = (x) => Array.isArray(x) ? x.filter((o) => !!o && typeof o === "object" && !Array.isArray(o)) : [];
  const checks = objs(r2.checks).map((c, i) => ({
    id: typeof c.id === "number" ? c.id : i + 1,
    surface: s(c.surface),
    name: s(c.name),
    main: truthy(c.main),
    ok: truthy(c.ok),
    expected: s(c.expected),
    observed: s(c.observed),
    shot: typeof c.shot === "string" && c.shot.trim() ? c.shot : null
  }));
  return {
    surfaces: Array.isArray(r2.surfaces) ? r2.surfaces.filter((x) => typeof x === "string") : [],
    // Unless blocked, the checks decide: a stated result that disagrees with them is overridden.
    result: result === "blocked" ? result : checks.some((c) => !c.ok) ? "fail" : "pass",
    reason,
    checks,
    unchecked: Array.isArray(r2.unchecked) ? r2.unchecked.map(s) : [],
    learned: objs(r2.learned).filter((l) => typeof l.note === "string" && l.note.trim()).map((l) => ({ surface: s(l.surface), note: s(l.note) })),
    proposals: objs(r2.proposals).filter((p) => typeof p.change === "string" && p.change.trim()).map((p) => ({ surface: s(p.surface), change: s(p.change) }))
  };
}
function verifyReview(v) {
  if (!v || v.result === "blocked") return invalidReview();
  if (v.result === "pass") return { verdict: "pass", confidence: 1, findings: [] };
  const findings = v.checks.filter((c) => !c.ok).map((c) => ({
    severity: c.main ? "critical" : "important",
    file: `verify/${c.surface || "app"}`,
    problem: `${c.name}: expected ${c.expected}, observed ${c.observed}`
  }));
  return { verdict: "fail", confidence: 1, findings };
}
var round3 = (n) => Math.round(n * 1e3) / 1e3;
var isEvidence = (f) => !!f.file?.trim() && !!f.problem.trim();
function reviewScore(r2) {
  if (r2.verdict === "pass") return 0.7 + 0.3 * r2.confidence;
  const concrete = r2.findings.some((f) => f.severity === "critical" || f.severity === "important");
  return r2.approach === "wrong" || !concrete ? 0.5 - 0.5 * r2.confidence : 0.6 - 0.1 * r2.confidence;
}
function synthesize(reviews, weights, validatorsOk, failingValidators = []) {
  const names2 = Object.keys(reviews).filter((n) => reviews[n]);
  const answered = names2.filter((n) => reviews[n].verdict !== "abstain");
  const all = answered.flatMap((n) => reviews[n].findings);
  const critical = all.filter((f) => f.severity === "critical" && isEvidence(f));
  const important = all.filter((f) => f.severity === "important");
  const minor = all.filter((f) => f.severity === "minor" || f.severity === "critical" && !isEvidence(f));
  const failImportant = answered.some((n) => reviews[n].verdict === "fail" && reviews[n].findings.some((f) => f.severity === "important"));
  const sumW = answered.reduce((s2, n) => s2 + weights[n], 0);
  const score = answered.length && sumW > 0 ? round3(answered.reduce((s2, n) => s2 + weights[n] * reviewScore(reviews[n]), 0) / sumW) : null;
  const reasons = [];
  let action;
  if (score === null) {
    action = validatorsOk ? "accept" : "fix";
    reasons.push("no reviewer answered: validators decide");
  } else if (score < 0.5) {
    action = "redo";
    reasons.push(`score ${score} < 0.5`);
  } else if (critical.length) {
    action = "fix";
    reasons.push(`${critical.length} critical finding(s) with evidence`);
  } else if (!validatorsOk) {
    action = "fix";
    reasons.push("validators failing");
  } else if (failImportant) {
    action = "fix";
    reasons.push("a failing reviewer reported important finding(s)");
  } else if (score >= 0.7) {
    action = "accept";
    reasons.push(`score ${score} >= 0.7`);
  } else {
    action = "fix";
    reasons.push(`score ${score} between 0.5 and 0.7`);
  }
  const blocking2 = [
    ...[...critical, ...important].map((f) => `${f.severity}|${f.file ?? ""}|${f.problem.trim().toLowerCase()}`),
    ...failingValidators.map((v) => `validator|${v.validator}|${v.failures.join("\n")}`)
  ].sort();
  const signature = (0, import_node_crypto.createHash)("sha256").update(JSON.stringify(blocking2)).digest("hex").slice(0, 16);
  return {
    action,
    score,
    reasons,
    critical,
    important,
    minor,
    signature,
    reviewers: names2.map((n) => ({ name: n, verdict: reviews[n].verdict, confidence: reviews[n].confidence, weight: weights[n], invalid: reviews[n].invalid === true, dropped: reviews[n].dropped ?? 0 }))
  };
}

// src/forge/loop.ts
var CAP = { medium: 3, large: 4 };
function decideRound(history, path17) {
  const cap = CAP[path17];
  const last = history.at(-1);
  const round = history.filter((h) => h.action !== "accept").length;
  const tierUp = round >= 3;
  if (!last) return { round: 0, cap, next: "resume", reason: "no verdict yet", tierUp };
  if (last.action === "accept") return { round, cap, next: "done", reason: "accepted", tierUp };
  const prev = history.at(-2);
  if (prev && prev.action !== "accept" && prev.signature === last.signature && prev.score === last.score) {
    return { round, cap, next: "stalled", reason: "same findings and score as the previous round", tierUp };
  }
  if (round > cap) return { round, cap, next: "breaker", reason: `round ${round} over the cap of ${cap}`, tierUp };
  if (last.action === "redo") return { round, cap, next: "redo", reason: `score under 0.5: start again from the brief with another approach${tierUp ? ", with an implementer one tier up" : ""}`, tierUp };
  if (round <= 2) return { round, cap, next: "resume", reason: `round ${round}: resume the implementer`, tierUp };
  return { round, cap, next: "fresh-stronger", reason: `round ${round}: fresh implementer one tier up`, tierUp };
}

// src/forge/proposals.ts
var import_node_fs7 = require("node:fs");
var import_node_path7 = __toESM(require("node:path"), 1);

// src/lib/proposals.ts
var PROPOSAL_CATEGORIES = ["feature", "security", "perf", "quality", "tests", "deps"];
var PROPOSAL_RISKS = ["low", "medium", "high"];
var PROPOSAL_STATUSES = ["proposed", "approved", "rejected", "discussing", "auto_approved", "done"];
var MAX_PROPOSAL_TEXT = 4e3;
var MAX_PROPOSAL_TITLE = 200;
var str4 = (x) => typeof x === "string";
var oneOf3 = (list, x) => str4(x) && list.includes(x);
function normalizeProposal(x) {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const o = x;
  if (!oneOf3(PROPOSAL_CATEGORIES, o.category) || !oneOf3(PROPOSAL_RISKS, o.risk) || !oneOf3(PROPOSAL_STATUSES, o.status)) return null;
  if (o.source !== "scout" && o.source !== "user") return null;
  if (!str4(o.title) || !o.title.trim() || !str4(o.author)) return null;
  const text = (v) => str4(v) ? v.slice(0, MAX_PROPOSAL_TEXT) : "";
  const out = {
    ts: str4(o.ts) ? o.ts : "",
    category: o.category,
    risk: o.risk,
    title: o.title.slice(0, MAX_PROPOSAL_TITLE),
    rationale: text(o.rationale),
    evidence: text(o.evidence),
    pillar: text(o.pillar).slice(0, MAX_PROPOSAL_TITLE),
    status: o.status,
    source: o.source,
    author: o.author
  };
  for (const k of ["estimate", "path", "decidedBy", "decidedAt"]) if (str4(o[k])) out[k] = o[k].slice(0, MAX_PROPOSAL_TITLE);
  if (str4(o.taskId) && /^[A-Za-z0-9_.-]{1,64}$/.test(o.taskId)) out.taskId = o.taskId;
  if (str4(o.reason)) out.reason = o.reason.slice(0, MAX_PROPOSAL_TEXT);
  return out;
}
var canDecide = (status) => status === "proposed" || status === "discussing";
var applyDecision = (d) => d === "approve" ? "approved" : d === "reject" ? "rejected" : "discussing";
var isActionable = (p) => p.status === "approved" || p.status === "auto_approved";

// src/forge/proposals.ts
var PROPOSAL_ID = /^p\d{14}[0-9a-z]{4}$/;
var dirOf = (root) => import_node_path7.default.join(root, ".forge", "proposals");
function proposalId(now, rand) {
  const stamp = now.toISOString().replace(/\D/g, "").slice(0, 14);
  let tail = "";
  for (let i = 0; i < 4; i++) tail += Math.floor(Math.min(Math.max(rand(), 0), 0.999999) * 36).toString(36);
  return `p${stamp}${tail}`;
}
function saveProposal(root, id2, doc) {
  forgeDir(root);
  (0, import_node_fs7.mkdirSync)(dirOf(root), { recursive: true });
  (0, import_node_fs7.writeFileSync)(import_node_path7.default.join(dirOf(root), `${id2}.json`), JSON.stringify(doc, null, 2) + "\n");
}
function loadOne(root, id2) {
  const file = import_node_path7.default.join(dirOf(root), `${id2}.json`);
  if (!(0, import_node_fs7.existsSync)(file)) return null;
  try {
    return normalizeProposal(JSON.parse((0, import_node_fs7.readFileSync)(file, "utf8")));
  } catch {
    return null;
  }
}
function loadProposals(root) {
  let names2 = [];
  try {
    names2 = (0, import_node_fs7.readdirSync)(dirOf(root));
  } catch {
    return [];
  }
  const out = [];
  for (const n of names2.sort()) {
    if (!n.endsWith(".json")) continue;
    const id2 = n.slice(0, -5);
    const doc = loadOne(root, id2);
    if (doc) out.push({ ...doc, id: id2 });
  }
  return out;
}
function decideDoc(doc, d, by, at, reason) {
  if (!canDecide(doc.status)) return { ok: false, error: "decided" };
  const { reason: _stale, ...rest } = doc;
  const next = { ...rest, status: applyDecision(d), decidedBy: by, decidedAt: at };
  if (reason) next.reason = reason;
  return { ok: true, doc: next };
}
function decideLocal(root, id2, d, by, at, reason) {
  const doc = loadOne(root, id2);
  if (!doc) return { ok: false, error: "missing" };
  const r2 = decideDoc(doc, d, by, at, reason);
  if (r2.ok) saveProposal(root, id2, r2.doc);
  return r2;
}
function mirrorProposal(root, id2, doc) {
  const prev = loadOne(root, id2);
  saveProposal(root, id2, doc);
  return { previous: prev ? prev.status : null };
}

// src/forge/policy.ts
var NEGATORS = /* @__PURE__ */ new Set([
  "no",
  "not",
  "without",
  "missing",
  "lacks",
  "nothing",
  "zero",
  "none",
  "absent",
  "untested",
  "pending",
  "would",
  "sin",
  "falta",
  "ning\xFAn",
  "ningun"
]);
var WORDS_BEFORE = 3;
var WORDS_AFTER = 3;
var BENCH_WORD = /\bbenchmarks?\b/giu;
var BENCH_COLON = /\bbench:/giu;
var OPS = /ops\/s/giu;
var BEFORE_AFTER = /\d+(?:\.\d+)?\s*ms\s*(?:→|->)\s*\d+(?:\.\d+)?\s*ms/giu;
var TEST_WORD = /\b(?:tests?|tested|spec)\b/giu;
var wordsIn = (s2) => s2.match(/[\p{L}\p{N}]+/gu) ?? [];
function hasUnnegated(text, re) {
  for (const m of text.matchAll(re)) {
    const before = wordsIn(text.slice(0, m.index)).slice(-WORDS_BEFORE);
    const after = wordsIn(text.slice(m.index + m[0].length)).slice(0, WORDS_AFTER);
    if (![...before, ...after].some((w) => NEGATORS.has(w.toLowerCase()))) return true;
  }
  return false;
}
function autoApprovable(p) {
  if (p.risk !== "low") return false;
  switch (p.category) {
    case "tests":
    case "quality":
      return true;
    case "perf":
      return [BENCH_WORD, BENCH_COLON, OPS, BEFORE_AFTER].some((re) => hasUnnegated(p.evidence, re));
    case "security":
      return hasUnnegated(p.evidence, TEST_WORD);
    default:
      return false;
  }
}
var norm2 = (s2) => s2.toLowerCase().replace(/\s+/g, " ").trim();
var words = (s2) => new Set((s2.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length >= 3));
var SIMILAR = 0.6;
function jaccard(a, b) {
  if (!a.size && !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}
function similarRejected(p, rejected) {
  const mine = words(`${p.title} ${p.rationale}`);
  for (const r2 of rejected) {
    if (jaccard(mine, words(`${r2.title} ${r2.rationale}`)) >= SIMILAR && norm2(r2.evidence).includes(norm2(p.evidence))) return r2.id;
  }
  return null;
}
function similarOpen(p, all) {
  const mine = words(`${p.title} ${p.rationale}`);
  for (const o of all) {
    if (o.status !== "proposed" && o.status !== "discussing" && o.status !== "approved" && o.status !== "auto_approved") continue;
    if (jaccard(mine, words(`${o.title} ${o.rationale}`)) >= SIMILAR) return o.id;
  }
  return null;
}
function safeZone(path17) {
  if (!path17 || !/^[A-Za-z0-9_./*-]+$/.test(path17) || path17.startsWith("-")) return null;
  if (path17.startsWith("/") || path17.split("/").includes("..")) return null;
  return path17;
}

// src/forge/to-task.ts
var IMPROVEMENTS_PHASE = "PX";
function proposalToTask(plan, p, opts) {
  let max = 0;
  for (const t of plan.tasks) {
    const m = /^T(\d+)$/.exec(t.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  const es2 = plan.locale.toLowerCase().startsWith("es");
  const existing = plan.phases.find((ph) => ph.id === IMPROVEMENTS_PHASE);
  const phase = existing ? null : { id: IMPROVEMENTS_PHASE, name: es2 ? "Mejoras" : "Improvements", plan_status: "provisional" };
  const zone = safeZone(p.path);
  const task = {
    id: `T${String(max + 1).padStart(3, "0")}`,
    title: p.title,
    track: opts.track ?? plan.tracks[0]?.id ?? "",
    phase: IMPROVEMENTS_PHASE,
    includes: p.rationale.slice(0, 300),
    done_when: es2 ? `${p.title} \u2014 los validadores pasan` : `${p.title} \u2014 validators pass`,
    depends_on: [],
    zones: zone ? [zone] : [],
    estimate_min: 30
  };
  return { task, phase };
}

// src/forge/cli/run.ts
var import_yaml5 = __toESM(require_dist(), 1);

// src/forge/cli/errors.ts
var UsageError = class extends Error {
};

// src/forge/cli/swarm.ts
var import_node_fs13 = require("node:fs");
var import_node_path14 = __toESM(require("node:path"), 1);

// src/forge/validators.ts
var import_node_fs8 = require("node:fs");
var import_node_path8 = __toESM(require("node:path"), 1);
var NPM_ORDER = [["typecheck", "typecheck"], ["type-check", "typecheck"], ["lint", "lint"], ["test", "test"], ["build", "build"]];
var PLACEHOLDER_TEST = /no test specified/i;
function onPath(name) {
  const win = process.platform === "win32";
  const exts = win ? ["", ...(process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean)] : [""];
  return (process.env.PATH ?? "").split(import_node_path8.default.delimiter).filter(Boolean).filter((dir) => !(win && /[\\/]WindowsApps[\\/]?$/i.test(dir))).some((dir) => exts.some((ext) => {
    try {
      return (0, import_node_fs8.existsSync)(import_node_path8.default.join(dir, name + ext));
    } catch {
      return false;
    }
  }));
}
function pythonFor(repo, which) {
  if (repo.exists(".venv/Scripts/python.exe")) return ".venv\\Scripts\\python.exe";
  if (repo.exists(".venv/bin/python")) return ".venv/bin/python";
  return which("python3") ? "python3" : "python";
}
function usesPytest(repo) {
  const pyproject = repo.read("pyproject.toml");
  if (pyproject !== null && /pytest/.test(pyproject)) return true;
  if (repo.exists("pytest.ini") || repo.exists("tox.ini") || repo.exists("conftest.py")) return true;
  const setupCfg = repo.read("setup.cfg");
  if (setupCfg !== null && /^\[tool:pytest\]/m.test(setupCfg)) return true;
  return repo.list("tests").some((f) => /^test_[^/\\]*\.py$/i.test(f));
}
function dotnetTarget(rootEntries) {
  const root = rootEntries.filter((f) => !f.includes("/"));
  const solutions = root.filter((f) => /\.slnx?$/i.test(f));
  if (solutions.length) return solutions.length === 1 ? solutions[0] : null;
  const projects = root.filter((f) => /\.csproj$/i.test(f));
  return projects.length === 1 ? projects[0] : null;
}
var E2E_SCRIPTS = ["e2e", "test:e2e", "test:integration"];
var CONFIGS = (base) => ["ts", "js", "mjs", "cjs"].map((e) => `${base}.${e}`);
function detected(repo, which, platform) {
  const out = [];
  const push = (v) => out.push({ ...v, source: "detected" });
  const pkgText = repo.read("package.json");
  let scripts = {};
  let runner = "npm";
  if (pkgText !== null) {
    try {
      scripts = JSON.parse(pkgText)?.scripts ?? {};
    } catch {
      scripts = {};
    }
    runner = repo.exists("bun.lock") || repo.exists("bun.lockb") ? "bun" : repo.exists("pnpm-lock.yaml") ? "pnpm" : repo.exists("yarn.lock") ? "yarn" : "npm";
    for (const [script, kind] of NPM_ORDER) {
      const body = scripts[script];
      if (typeof body !== "string" || !body.trim()) continue;
      if (script === "test" && PLACEHOLDER_TEST.test(body)) continue;
      if (kind === "typecheck" && out.some((v) => v.kind === "typecheck")) continue;
      const cmd = script === "test" ? `${runner} test` : runner === "yarn" ? `yarn ${script}` : `${runner} run ${script}`;
      push({ name: script, cmd, kind });
    }
  }
  const run2 = (s2) => runner === "yarn" ? `yarn ${s2}` : `${runner} run ${s2}`;
  const has = (s2) => typeof scripts[s2] === "string" && scripts[s2].trim() !== "";
  const e2eScripts = E2E_SCRIPTS.filter(has);
  for (const s2 of e2eScripts) push({ name: s2, cmd: run2(s2), kind: "e2e" });
  if (!e2eScripts.length) {
    if (CONFIGS("playwright.config").some((f) => repo.exists(f))) push({ name: "playwright", cmd: "npx playwright test", kind: "e2e" });
    if (CONFIGS("cypress.config").some((f) => repo.exists(f))) push({ name: "cypress", cmd: "npx cypress run", kind: "e2e" });
    if ([".detoxrc", ".detoxrc.js", ".detoxrc.json", "detox.config.js"].some((f) => repo.exists(f))) push({ name: "detox", cmd: "npx detox test", kind: "e2e" });
  }
  if (has("bench")) push({ name: "bench", cmd: run2("bench"), kind: "bench" });
  if (usesPytest(repo)) push({ name: "pytest", cmd: `${pythonFor(repo, which)} -m pytest -q`, kind: "test" });
  if (repo.exists("Cargo.toml")) push({ name: "cargo-test", cmd: "cargo test", kind: "test" });
  if (repo.exists("go.mod")) {
    push({ name: "go-vet", cmd: "go vet ./...", kind: "lint" });
    push({ name: "go-test", cmd: "go test ./...", kind: "test" });
  }
  const dotnet = dotnetTarget(repo.list());
  if (dotnet) push({ name: "dotnet-test", cmd: `dotnet test ${/\s/.test(dotnet) ? `"${dotnet}"` : dotnet}`, kind: "test" });
  if (repo.exists("pubspec.yaml")) {
    push({ name: "flutter-analyze", cmd: "flutter analyze", kind: "lint" });
    push({ name: "flutter-test", cmd: "flutter test", kind: "test" });
  }
  const gw = repo.exists("gradlew") ? "" : repo.exists("android/gradlew") ? "android/" : null;
  const androidApp = gw !== null && ["app/build.gradle", "app/build.gradle.kts"].some((f) => /com\.android\.application/.test(repo.read(gw + f) ?? ""));
  if (pkgText === null && androidApp && !repo.exists("pubspec.yaml")) {
    const g = `${gw ? "cd android && " : ""}${platform === "win32" ? "gradlew.bat" : "./gradlew"}`;
    push({ name: "gradle-lint", cmd: `${g} lint`, kind: "lint" });
    push({ name: "gradle-test", cmd: `${g} testDebugUnitTest`, kind: "test" });
  }
  const make = repo.read("GNUmakefile") ?? repo.read("makefile") ?? repo.read("Makefile");
  if (make !== null && /^test\s*:(?!=)/m.test(make) && !out.some((v) => v.kind === "test")) push({ name: "make-test", cmd: "make test", kind: "test" });
  return out;
}
var sameCmd = (cmd) => cmd.replace(/\s+/g, " ").trim();
function detectValidators(repo, config, which = onPath, platform = process.platform) {
  const manual = (config.validators ?? []).map((v) => ({ ...v, kind: v.kind ?? "other", source: "manual" }));
  if (!config.detect) return manual;
  const byName = new Map(manual.map((v) => [v.name, v]));
  const manualCmds = new Set(manual.map((v) => sameCmd(v.cmd)));
  const merged = detected(repo, which, platform).filter((v) => !config.exclude.includes(v.name) && (byName.has(v.name) || !manualCmds.has(sameCmd(v.cmd)))).map((v) => byName.get(v.name) ?? v);
  const used = new Set(merged.map((v) => v.name));
  return [...merged, ...manual.filter((v) => !used.has(v.name))];
}
function globMatch(glob, file) {
  const re = glob.split("**").map((part) => part.split("*").map((s2) => s2.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*")).join(".*");
  return new RegExp(`^${re}$`).test(file.replace(/\\/g, "/"));
}
var KNOWN = /* @__PURE__ */ new Set(["test", "lint", "typecheck", "other", "build", "e2e", "bench"]);
var covers = (v, files) => !v.affects?.length || files.some((f) => v.affects.some((g) => globMatch(g, f)));
function runsIn(v, scope) {
  const when = v.when ?? (KNOWN.has(v.kind) ? void 0 : "medium");
  const m = scope.mode;
  if (when === "always") return true;
  if (when === "medium") return m === "heavy" || m === "final";
  if (when === "final") return m === "final";
  if (v.kind === "build") return m !== "affected";
  if (v.kind === "bench") return m === "final";
  if (v.kind === "e2e") return m === "final" || m === "heavy" && (scope.changed === null || covers(v, scope.changed));
  return true;
}
function selectValidators(all, scope) {
  return all.filter((v) => runsIn(v, scope) && (scope.mode !== "affected" || covers(v, scope.files)));
}
var FAILURE = /(fail|error|✗|×|assert|panic|exception)/i;
function failureLines(output) {
  const lines = output.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim());
  const hits = lines.filter((l) => FAILURE.test(l));
  return (hits.length ? hits.slice(-20) : lines.slice(-10)).map((l) => l.slice(0, 200));
}
var NO_TESTS = /\b(no test files found|no tests found)\b/i;
var RUNS_TESTS = /* @__PURE__ */ new Set(["test", "e2e"]);
function runValidators(list, exec, timeoutSec) {
  return list.map((v) => {
    const first = exec(v.cmd, timeoutSec);
    if (first.code === 0 && !first.timedOut) return { validator: v.name, ok: true, flaky: false, durationMs: first.ms, failures: [] };
    if (first.timedOut) return { validator: v.name, ok: false, flaky: false, durationMs: first.ms, failures: [`timeout after ${timeoutSec} s`] };
    if (RUNS_TESTS.has(v.kind) && NO_TESTS.test(first.output)) return { validator: v.name, ok: true, flaky: false, durationMs: first.ms, failures: failureLines(first.output), skipped: "no-tests" };
    const second = exec(v.cmd, timeoutSec);
    if (second.code === 0 && !second.timedOut) return { validator: v.name, ok: true, flaky: true, durationMs: first.ms + second.ms, failures: failureLines(first.output) };
    return { validator: v.name, ok: false, flaky: false, durationMs: first.ms + second.ms, failures: second.timedOut ? [`timeout after ${timeoutSec} s`] : failureLines(second.output) };
  });
}
function markPreexisting(results, baseline) {
  const failedBefore = new Set((Array.isArray(baseline) ? baseline : []).filter((b) => !!b && typeof b === "object" && typeof b.validator === "string" && b.ok === false).map((b) => b.validator));
  return results.map((r2) => !r2.ok && failedBefore.has(r2.validator) ? { ...r2, preexisting: true } : r2);
}
var blocking = (r2) => r2.ok !== true && r2.preexisting !== true;

// src/forge/schedule.ts
var NUDGE_MINUTES = 15;
var RELAUNCH_CAP = 2;
var STEP_WAIT_SECONDS = 300;
function relaunchOrBlock(task, attempts) {
  if (attempts >= RELAUNCH_CAP) return { type: "block", task, reason: `the session of ${task} stopped ${attempts + 1} times` };
  return { type: "relaunch", task, attempt: attempts + 1 };
}
var HELD = ["running", "accepted", "conflict", "blocked"];
var ACTIVE = ["claimed", "in_progress"];
function ranker(plan) {
  const phaseAt = new Map(plan.phases.map((p, i) => [p.id, i]));
  const planAt = new Map(plan.tasks.map((t, i) => [t.id, i]));
  return (t) => (phaseAt.get(t.phase) ?? 0) * 1e6 + (planAt.get(t.id) ?? 0);
}
function schedule(i) {
  const { plan, states, sessions, exec, now } = i;
  const integrated = new Set(i.integrated);
  const rank = ranker(plan);
  const byId = new Map(plan.tasks.map((t) => [t.id, t]));
  const nowIso = new Date(now).toISOString();
  const tasks = { ...exec.tasks };
  const held = (id2) => HELD.includes(tasks[id2]?.status);
  const depIntegrated = (d) => statusOf(states, d) === "done" && commitShas(states, d).every((s2) => integrated.has(s2));
  const owner = (id2) => states[id2]?.owner ?? null;
  const claimedByOther = (id2) => {
    const o = owner(id2);
    return !!o && o !== exec.coordinator && ACTIVE.includes(statusOf(states, id2)) && sessionLiveness(sessions[o], now) !== "stopped";
  };
  const orphan = (id2) => ACTIVE.includes(statusOf(states, id2)) && !!owner(id2) && owner(id2) !== exec.coordinator && !claimedByOther(id2);
  const readopt = (id2) => ACTIVE.includes(statusOf(states, id2)) && owner(id2) === exec.coordinator && !tasks[id2];
  const pub = i.publicTasks ?? {};
  const agents = i.agents ?? null;
  for (const [id2, t] of Object.entries(tasks)) {
    const p = pub[id2];
    if (t.executor === "subagents" || !p || p.runId !== exec.runId || p.by === exec.coordinator) continue;
    tasks[id2] = { ...t, stage: p.stage, round: p.round, agent: p.agent, stageSince: p.since, updatedAt: p.updatedAt };
  }
  for (const [id2, t] of Object.entries(tasks)) {
    if (t.status !== "running" || t.executor === "subagents") continue;
    if (statusOf(states, id2) === "done") {
      tasks[id2] = { ...t, status: "accepted", stage: "integrate", updatedAt: nowIso };
      continue;
    }
    const p = pub[id2];
    const own = !!p && p.runId === exec.runId && p.by !== exec.coordinator;
    if (own && p.status === "blocked" || statusOf(states, id2) === "blocked") {
      tasks[id2] = { ...t, status: "blocked", detail: "blocked by its session", updatedAt: nowIso, finishedAt: nowIso };
    }
  }
  for (const t of plan.tasks) {
    const o = owner(t.id);
    const shas = commitShas(states, t.id);
    if (tasks[t.id] || statusOf(states, t.id) !== "done" || !o || o === exec.coordinator || !shas.length || shas.every((s2) => integrated.has(s2))) continue;
    tasks[t.id] = { status: "accepted", stage: "integrate", round: 0, worktree: "", branch: `task/${t.id}`, executor: "manual", attempts: 0, agent: null, startedAt: nowIso, stageSince: nowIso, updatedAt: nowIso, detail: null, title: t.title };
  }
  for (const [id2, t] of Object.entries(tasks)) if (!t.title && byId.get(id2)?.title) tasks[id2] = { ...t, title: byId.get(id2).title };
  const startable = (t) => !held(t.id) && (isAvailable(t, states) && isUnlocked(t, states) || orphan(t.id) || readopt(t.id)) && t.depends_on.every(depIntegrated) && !claimedByOther(t.id);
  const actions = [];
  const accepted = Object.keys(tasks).filter((id2) => tasks[id2].status === "accepted" && byId.has(id2)).sort((a, b) => rank(byId.get(a)) - rank(byId.get(b)));
  if (accepted.length) actions.push({ type: "integrate", task: accepted[0], ref: tasks[accepted[0]].branch });
  const listed = (id2) => agents?.find((a) => a.name === `wp-${exec.project}-${id2}`) ?? null;
  for (const id2 of Object.keys(tasks)) {
    const t = tasks[id2];
    if (t.status !== "running" || t.executor !== "sessions") continue;
    const o = owner(id2);
    const pastLease = now - Date.parse(t.startedAt) > LEASE_MINUTES * 6e4;
    const ownerStopped = !!o && o !== exec.coordinator && sessionLiveness(sessions[o], now) === "stopped";
    const neverClaimed = !o;
    if (pastLease && (ownerStopped || neverClaimed) && !listed(id2)) {
      const a = relaunchOrBlock(id2, t.attempts);
      if (a.type === "block") tasks[id2] = { ...t, status: "blocked", detail: a.reason, updatedAt: nowIso, finishedAt: nowIso };
      actions.push(a);
      continue;
    }
    const quiet = now - Date.parse(t.stageSince) >= NUDGE_MINUTES * 6e4;
    const nudgedLately = !!t.nudgedAt && now - Date.parse(t.nudgedAt) < NUDGE_MINUTES * 6e4;
    if (quiet && !nudgedLately && listed(id2)?.state === "idle") actions.push({ type: "nudge", task: id2, stage: t.stage });
  }
  const runningIds = Object.keys(tasks).filter((id2) => tasks[id2].status === "running");
  const busy = runningIds.map((id2) => byId.get(id2)).filter((t) => !!t);
  let slots = exec.parallel - runningIds.length;
  for (const t of [...plan.tasks].sort((a, b) => rank(a) - rank(b))) {
    if (slots <= 0) break;
    if (!startable(t)) continue;
    const clash = busy.some((b) => overlappingZones(zonesOf(t, states[t.id]), zonesOf(b, states[b.id])).length > 0);
    if (clash) continue;
    tasks[t.id] = { status: "running", stage: "brief", round: 0, worktree: "", branch: `task/${t.id}`, executor: exec.mode, attempts: 0, agent: null, startedAt: nowIso, stageSince: nowIso, updatedAt: nowIso, detail: null, title: t.title };
    busy.push(t);
    slots--;
    actions.push({ type: "start", task: t.id });
  }
  let { active, stopReason: stopReason2, stallReason } = exec;
  const moving = actions.length > 0 || runningIds.length > 0;
  const allDone = plan.tasks.every((t) => statusOf(states, t.id) === "done");
  if (!moving && allDone) {
    actions.push({ type: "finish" });
    active = false;
    stopReason2 = "finished";
    stallReason = null;
  } else if (!moving && plan.tasks.some((t) => statusOf(states, t.id) !== "done" && claimedByOther(t.id))) {
    actions.push({ type: "wait", seconds: STEP_WAIT_SECONDS });
  } else if (!moving) {
    stallReason = describeStall(plan, states, tasks, depIntegrated);
    actions.push({ type: "stalled", reason: stallReason });
    active = false;
    stopReason2 = "stalled";
  } else {
    actions.push({ type: "wait", seconds: accepted.length ? 0 : STEP_WAIT_SECONDS });
  }
  return { actions, next: { ...exec, tasks, active, stopReason: stopReason2, stallReason, lastStepAt: nowIso, planned: plan.tasks.length } };
}
function describeStall(plan, states, tasks, depIntegrated) {
  const groups = /* @__PURE__ */ new Map();
  const add = (key, id2) => groups.set(key, [...groups.get(key) ?? [], id2]);
  for (const t of plan.tasks) {
    if (statusOf(states, t.id) === "done") continue;
    const ex = tasks[t.id];
    if (ex?.status === "conflict") add("conflict", t.id);
    else if (ex?.status === "blocked" || statusOf(states, t.id) === "blocked") add("blocked", t.id);
    else {
      const dep = t.depends_on.find((d) => !depIntegrated(d));
      if (dep) add(`waits for ${dep} (${statusOf(states, dep) === "done" ? "not integrated" : "not done"})`, t.id);
    }
  }
  return [...groups].map(([k, ids]) => `${k}: ${ids.join(", ")}`).join("; ") || "nothing can move";
}
function widthOf(plan) {
  const done = /* @__PURE__ */ new Set();
  let width = 0;
  for (let guard = 0; guard < plan.tasks.length + 1 && done.size < plan.tasks.length; guard++) {
    const wave = [];
    for (const t of plan.tasks) {
      if (done.has(t.id) || !t.depends_on.every((d) => done.has(d))) continue;
      if (wave.some((w) => overlappingZones(t.zones, w.zones).length > 0)) continue;
      wave.push(t);
    }
    if (!wave.length) break;
    width = Math.max(width, wave.length);
    for (const t of wave) done.add(t.id);
  }
  return width;
}

// src/lib/execution-view.ts
var FUTURE_TOLERANCE_MS = 2 * 6e4;
var AGENT_ALIVE_MS = 3 * 36e5;
function usable(ts, now) {
  const t = ts ? Date.parse(ts) : NaN;
  return Number.isFinite(t) && t - now <= FUTURE_TOLERANCE_MS ? t : null;
}
function signalLiveness(ts, ended, now) {
  const t = usable(ts, now);
  if (ended || t === null) return "stopped";
  const age = Math.max(0, now - t);
  return age < LIVE_SILENT_MINUTES * 6e4 ? "alive" : age < LIVE_STOPPED_MINUTES * 6e4 ? "silent" : "stopped";
}

// src/forge/live.ts
var import_node_fs11 = require("node:fs");
var import_node_path11 = __toESM(require("node:path"), 1);

// src/forge/local.ts
var import_node_child_process = require("node:child_process");
var import_node_fs9 = require("node:fs");
var import_node_path9 = __toESM(require("node:path"), 1);
var import_yaml3 = __toESM(require_dist(), 1);
function mainCheckout(root) {
  try {
    const [gitDir, common] = (0, import_node_child_process.execFileSync)("git", ["rev-parse", "--git-dir", "--git-common-dir"], { cwd: root, encoding: "utf8", timeout: 5e3, stdio: ["ignore", "pipe", "ignore"], windowsHide: true }).split(/\r?\n/).map((l) => l.trim());
    if (!gitDir || !common) return root;
    const commonDir = import_node_path9.default.resolve(root, common);
    if (import_node_path9.default.resolve(root, gitDir) === commonDir || import_node_path9.default.basename(commonDir) !== ".git") return root;
    return import_node_path9.default.dirname(commonDir);
  } catch {
    return root;
  }
}
var localFile = (root) => import_node_path9.default.join(mainCheckout(root), ".forge", "local.yaml");
var names = (x) => Array.isArray(x) ? [...new Set(x.filter((s2) => typeof s2 === "string" && NAME.test(s2)))] : [];
function readLocal(root) {
  let raw = null;
  try {
    raw = (0, import_yaml3.parse)((0, import_node_fs9.readFileSync)(localFile(root), "utf8"));
  } catch {
    raw = null;
  }
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const surfaces = {};
  if (o.surfaces && typeof o.surfaces === "object" && !Array.isArray(o.surfaces)) {
    for (const [k, v] of Object.entries(o.surfaces)) {
      if (!NAME.test(k) || !v || typeof v !== "object" || Array.isArray(v)) continue;
      const p = v;
      if (p.state === "allowed" || p.state === "denied") surfaces[k] = { state: p.state, hash: typeof p.hash === "string" ? p.hash : null };
    }
  }
  return { ...o, surfaces, known: names(o.known), proposed: names(o.proposed) };
}
function writeLocal(root, s2) {
  forgeDir(mainCheckout(root));
  const file = localFile(root);
  const tmp = `${file}.${process.pid}.tmp`;
  (0, import_node_fs9.writeFileSync)(tmp, (0, import_yaml3.stringify)(s2));
  (0, import_node_fs9.renameSync)(tmp, file);
}
function updateLocal(root, fn) {
  const next = fn(readLocal(root));
  writeLocal(root, next);
  return next;
}

// src/forge/members.ts
var import_node_fs10 = require("node:fs");
var import_node_path10 = __toESM(require("node:path"), 1);
var isMemberId = (s2) => isSafeId(s2);
var memberFile = (main, sessionId) => import_node_path10.default.join(main, ".forge", "members", `${sessionId}.json`);
function normalizeMember(x) {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const o = x;
  const sessionId = typeof o.sessionId === "string" && isMemberId(o.sessionId) ? o.sessionId : null;
  const role = o.role === "executor" || o.role === "manual" ? o.role : null;
  const runId = typeof o.runId === "string" && o.runId ? o.runId.slice(0, 120) : null;
  const since = typeof o.since === "string" && !Number.isNaN(Date.parse(o.since)) ? o.since : null;
  if (!sessionId || !role || !runId || !since) return null;
  const task = typeof o.task === "string" && isPlanId(o.task) ? o.task : null;
  const name = typeof o.name === "string" && o.name ? o.name.slice(0, 80) : null;
  const hookSession = typeof o.hookSession === "string" && isMemberId(o.hookSession) ? o.hookSession : null;
  return { sessionId, role, runId, task, name, since, hookSession };
}
function readMember(main, sessionId) {
  if (!isMemberId(sessionId)) return null;
  try {
    const m = normalizeMember(JSON.parse((0, import_node_fs10.readFileSync)(memberFile(main, sessionId), "utf8")));
    return m && m.sessionId === sessionId ? m : null;
  } catch {
    return null;
  }
}
function writeMember(main, input) {
  const m = { ...input, hookSession: input.hookSession ?? null };
  if (!isMemberId(m.sessionId)) throw new Error(`invalid member session id: ${JSON.stringify(m.sessionId.slice(0, 130))}`);
  if (m.hookSession !== null && !isMemberId(m.hookSession)) throw new Error(`invalid member hook session id: ${JSON.stringify(m.hookSession.slice(0, 130))}`);
  forgeDir(main);
  const file = memberFile(main, m.sessionId);
  (0, import_node_fs10.mkdirSync)(import_node_path10.default.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    (0, import_node_fs10.writeFileSync)(tmp, JSON.stringify(m, null, 2) + "\n");
    (0, import_node_fs10.renameSync)(tmp, file);
  } finally {
    (0, import_node_fs10.rmSync)(tmp, { force: true });
  }
}
function listMembers(main, runId) {
  let names2 = [];
  try {
    names2 = (0, import_node_fs10.readdirSync)(import_node_path10.default.join(main, ".forge", "members")).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  return names2.slice(0, 200).map((f) => readMember(main, f.slice(0, -5))).filter((m) => !!m && m.runId === runId).slice(0, 50);
}
function findMemberByHook(main, hookSessionId, runId) {
  if (!isMemberId(hookSessionId)) return null;
  return listMembers(main, runId).find((m) => m.hookSession === hookSessionId && m.runId === runId) ?? null;
}
function memberForHook(main, hookSessionId, runId) {
  const byHook = findMemberByHook(main, hookSessionId, runId);
  if (byHook) return byHook;
  const direct = readMember(main, hookSessionId);
  return direct && direct.runId === runId && (direct.hookSession === null || direct.hookSession === hookSessionId) ? direct : null;
}

// src/forge/live.ts
var liveFile = (main, sessionId) => import_node_path11.default.join(main, ".forge", "live", `${sessionId}.json`);
var EVENTS = ["SessionStart", "SessionEnd", "SubagentStart", "SubagentStop", "Stop"];
var AGENT_STALE_MS = 3 * 36e5;
var SAFE = /^[A-Za-z0-9_\-.]{1,120}$/;
function nextLive(prev, ev, ctx) {
  let agents = prev?.agents ?? [];
  if (ev.event === "SubagentStart" && ev.agentId) agents = [...agents.filter((a) => a.id !== ev.agentId), { id: ev.agentId, type: ev.agentType ?? "", since: ctx.now }].slice(-20);
  if (ev.event === "SubagentStop" && ev.agentId) agents = agents.filter((a) => a.id !== ev.agentId);
  if (ev.event === "SessionEnd") agents = [];
  const cutoff = Date.parse(ctx.now) - AGENT_STALE_MS;
  agents = agents.filter((a) => {
    const t = Date.parse(a.since);
    return !Number.isFinite(t) || t >= cutoff;
  });
  const ended = ev.event === "SessionEnd" ? true : ev.event === "SessionStart" ? false : prev?.ended ?? false;
  return { sessionId: ctx.sessionId, role: ctx.role, runId: ctx.runId, task: ctx.task, event: ev.event, ts: ctx.now, agents, ended };
}
function hookLive(io, forced) {
  try {
    const input = JSON.parse(io.stdin ?? "");
    const sessionId = typeof input.session_id === "string" && SAFE.test(input.session_id) ? input.session_id : null;
    const named = EVENTS.includes(input.hook_event_name) ? input.hook_event_name : null;
    const event = forced ?? named;
    if (!sessionId || !event) return "";
    const main = mainCheckout(io.cwd);
    let exec = readExecution(main);
    if (!exec?.active) return "";
    const found = memberForHook(main, sessionId, exec.runId);
    if (exec.hookSession === null && event === "SubagentStart" && !found) {
      exec = { ...exec, hookSession: sessionId };
      saveExecution(main, exec);
    }
    const member = exec.hookSession === sessionId ? null : found;
    if (exec.hookSession !== sessionId && !member) return "";
    const role = member ? member.role : "coordinator";
    const signalId = member ? member.sessionId : sessionId;
    const file = liveFile(main, signalId);
    let prev = null;
    try {
      prev = normalizeLive(JSON.parse((0, import_node_fs11.readFileSync)(file, "utf8")));
    } catch {
      prev = null;
    }
    const doc = nextLive(
      prev,
      { event, agentId: typeof input.agent_id === "string" ? input.agent_id : void 0, agentType: typeof input.agent_type === "string" ? input.agent_type : void 0 },
      { sessionId: signalId, role, runId: exec.runId, task: member?.task ?? null, now: io.now().toISOString() }
    );
    forgeDir(main);
    (0, import_node_fs11.mkdirSync)(import_node_path11.default.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      (0, import_node_fs11.writeFileSync)(tmp, JSON.stringify(doc));
      (0, import_node_fs11.renameSync)(tmp, file);
    } finally {
      (0, import_node_fs11.rmSync)(tmp, { force: true });
    }
    if (event === "SessionStart" && !forced) {
      const running = Object.values(exec.tasks).filter((t) => t.status === "running").length;
      const text = role === "coordinator" ? `forge: this session coordinates the execution ${exec.runId} (${exec.mode}, ${running}/${exec.parallel} running, run branch ${exec.branch}). Resume it with /forge:run \u2192 Resume: renew your lease, reconcile each task and keep stepping.` : `forge: this session is the ${role} session of ${member?.task ?? "a task"} in the execution ${exec.runId} coordinated by ${exec.coordinator}. Resume it with /forge:run \u2192 Run member: rejoin with FORGE swarm join, renew your lease and continue from your last reported stage.`;
      return JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text } });
    }
  } catch {
  }
  return "";
}

// src/lib/worktree.ts
var import_node_path12 = __toESM(require("node:path"), 1);
function mainWorktreeFrom(porcelain) {
  if (typeof porcelain !== "string") return null;
  const line = porcelain.split(/\r?\n/).find((l) => l.startsWith("worktree "));
  return line ? line.slice("worktree ".length).trim() || null : null;
}
function samePath(a, b) {
  const norm3 = (p) => {
    const r2 = import_node_path12.default.resolve(p.replace(/\\/g, "/"));
    return process.platform === "win32" ? r2.toLowerCase() : r2;
  };
  return norm3(a) === norm3(b);
}

// src/forge/loose.ts
var import_node_fs12 = require("node:fs");
var import_node_path13 = __toESM(require("node:path"), 1);
var looseFile = (root) => import_node_path13.default.join(root, ".forge", "loose.json");
var PATHS = ["trivial", "small", "medium"];
var badZone = (z) => typeof z !== "string" || !z || z.length > 300 || /^([/\\]|[A-Za-z]:)/.test(z) || z.split(/[/\\]/).includes("..");
function parseLooseTasks(x) {
  if (!Array.isArray(x)) return { error: "the tasks must be a JSON array" };
  if (x.length < 2) return { error: "an ephemeral run needs at least 2 tasks (one alone is a normal task)" };
  if (x.length > LOOSE_MAX_TASKS) return { error: `an ephemeral run takes at most ${LOOSE_MAX_TASKS} tasks` };
  const tasks = [];
  for (const raw of x) {
    const o = raw && typeof raw === "object" ? raw : {};
    const id2 = typeof o.id === "string" ? o.id : "";
    if (!isPlanId(id2)) return { error: `invalid id ${String(o.id).slice(0, 80)}` };
    if (tasks.some((t) => t.id === id2)) return { error: `duplicate id ${id2}` };
    if (o.path === "large") return { error: `${id2}: a Large request follows its own path (design), not an ephemeral run` };
    if (!PATHS.includes(o.path)) return { error: `${id2}: path must be trivial, small or medium` };
    const title = typeof o.title === "string" ? o.title.trim().slice(0, 200) : "";
    if (!title) return { error: `${id2}: a title is required` };
    const zones = Array.isArray(o.zones) ? o.zones : [];
    if (zones.length > 50 || zones.some(badZone)) return { error: `${id2}: invalid zone (relative paths or globs inside the repo, at most 50)` };
    const deps = Array.isArray(o.depends_on) ? o.depends_on : [];
    if (deps.some((d) => typeof d !== "string")) return { error: `${id2}: depends_on must list task ids` };
    tasks.push({ id: id2, title, path: o.path, zones: zones.length ? zones : ["**"], depends_on: [...new Set(deps)] });
  }
  const ids = new Set(tasks.map((t) => t.id));
  for (const t of tasks) {
    if (t.depends_on.includes(t.id)) return { error: `${t.id} depends on itself` };
    const unknown = t.depends_on.find((d) => !ids.has(d));
    if (unknown) return { error: `${t.id} depends on unknown ${unknown.slice(0, 80)}` };
  }
  const left = new Map(tasks.map((t) => [t.id, t.depends_on.length]));
  const ready = tasks.filter((t) => !t.depends_on.length).map((t) => t.id);
  while (ready.length) {
    const id2 = ready.pop();
    left.delete(id2);
    for (const t of tasks) if (left.has(t.id) && t.depends_on.includes(id2)) {
      const n = left.get(t.id) - 1;
      left.set(t.id, n);
      if (n === 0) ready.push(t.id);
    }
  }
  if (left.size) return { error: `dependency cycle among ${[...left.keys()].join(", ")}` };
  return { tasks };
}
function planOfLoose(tasks) {
  return {
    tracks: [{ id: "loose", name: "loose", color: "blue" }],
    phases: [{ id: "loose", name: "loose", plan_status: "committed" }],
    versions: [],
    tasks: tasks.map((t) => ({ id: t.id, title: t.title, track: "loose", phase: "loose", done_when: t.title, depends_on: t.depends_on, zones: t.zones }))
  };
}
function statesOfLoose(e) {
  const out = {};
  for (const [id2, t] of Object.entries(e.tasks)) {
    if (t.status === "integrated") out[id2] = { status: "done" };
    else if (t.status === "blocked") out[id2] = { status: "blocked", blockedBy: ["external"] };
  }
  return out;
}
function writeLoose(root, doc) {
  forgeDir(root);
  const file = looseFile(root);
  (0, import_node_fs12.mkdirSync)(import_node_path13.default.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    (0, import_node_fs12.writeFileSync)(tmp, JSON.stringify(doc, null, 2) + "\n");
    (0, import_node_fs12.renameSync)(tmp, file);
  } finally {
    (0, import_node_fs12.rmSync)(tmp, { force: true });
  }
}
function readLoose(root, runId) {
  try {
    const raw = JSON.parse((0, import_node_fs12.readFileSync)(looseFile(root), "utf8"));
    if (raw.runId !== runId) return null;
    const r2 = parseLooseTasks(raw.tasks);
    return "error" in r2 ? null : { runId, tasks: r2.tasks };
  } catch {
    return null;
  }
}

// src/forge/cli/swarm.ts
var ID = /^[A-Za-z0-9_\-.~:@+]{1,80}$/;
var TAKEOVER_MIN = 15;
var MAX_SLEEP_S = 900;
function readDocs(dir) {
  const out = {};
  for (const f of (0, import_node_fs13.readdirSync)(dir).filter((x) => x.endsWith(".json"))) {
    try {
      out[f.slice(0, -5)] = JSON.parse((0, import_node_fs13.readFileSync)(import_node_path14.default.join(dir, f), "utf8"));
    } catch {
    }
  }
  return out;
}
var VENV_HINT = "python project: set swarm.setup in .forge/config.yaml to create the venv in each worktree";
function setupFor(repo, configured) {
  if (configured) return { cmd: configured };
  if (repo.exists(".venv")) return { cmd: null, hint: VENV_HINT };
  if (repo.exists("package-lock.json")) return { cmd: "npm ci" };
  if (repo.exists("pnpm-lock.yaml")) return { cmd: "pnpm install --frozen-lockfile" };
  if (repo.exists("yarn.lock")) return { cmd: "yarn install --frozen-lockfile" };
  return null;
}
function runSetup(deps, dir, root) {
  const config = loadConfig(root);
  const wt = deps.at(dir).repo;
  const mainRepo = deps.at(root).repo;
  const repo = { ...wt, exists: (rel) => rel === ".venv" ? mainRepo.exists(rel) : wt.exists(rel) };
  const plan = setupFor(repo, config.swarm.setup);
  if (!plan) return null;
  if (plan.cmd === null) return { cmd: null, ok: false, tail: [plan.hint] };
  const r2 = deps.at(dir).exec(plan.cmd, config.validatorTimeoutSec);
  return { cmd: plan.cmd, ok: r2.code === 0 && !r2.timedOut, tail: r2.output.split(/\r?\n/).filter((l) => l.trim()).slice(-20) };
}
function worktreeHolding(porcelain, branch) {
  let at = null;
  for (const line of (porcelain ?? "").split(/\r?\n/)) {
    if (line.startsWith("worktree ")) at = line.slice("worktree ".length).trim();
    else if (line === `branch refs/heads/${branch}`) return at;
  }
  return null;
}
var sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function loadPlanArg(io, planArg, sub) {
  if (!planArg) throw new UsageError(`swarm ${sub}: --plan is required`);
  try {
    return parsePlan((0, import_node_fs13.readFileSync)(import_node_path14.default.resolve(io.cwd, planArg), "utf8"));
  } catch (e) {
    throw new UsageError(e instanceof PlanError ? `${planArg}: ${e.issues.join("; ")}` : `swarm ${sub}: cannot read ${planArg}`);
  }
}
function loadTasksArg(io, file, sub) {
  if (!file) throw new UsageError(`swarm ${sub}: --tasks is required for an ephemeral run`);
  let raw;
  try {
    raw = JSON.parse((0, import_node_fs13.readFileSync)(import_node_path14.default.resolve(io.cwd, file), "utf8"));
  } catch {
    throw new UsageError(`swarm ${sub}: cannot read ${file}`);
  }
  const r2 = parseLooseTasks(raw);
  if ("error" in r2) throw new UsageError(`swarm ${sub}: ${r2.error}`);
  return r2.tasks;
}
function addTaskWorktree(deps, main, task, runBranch2) {
  const dir = taskWorktree(main, task);
  const branch = taskBranch(task);
  let setup = null;
  if (!(0, import_node_fs13.existsSync)(dir)) {
    const g = (args) => deps.git(["-C", main, ...args]);
    const exists = g(["rev-parse", "--verify", "-q", `refs/heads/${branch}`]) !== null;
    const added = exists ? g(["worktree", "add", dir, branch]) : g(["worktree", "add", "-b", branch, dir, runBranch2]);
    if (added === null) throw new UsageError(`swarm worktree: cannot add ${dir} for ${branch}`);
    setup = runSetup(deps, dir, main);
  }
  return { worktree: dir, branch, base: deps.at(dir).git(["rev-parse", "HEAD"])?.trim() ?? null, setup };
}
function readTickInput(io, deps, e, planArg, db, sub) {
  const plan = loadPlanArg(io, planArg, sub);
  if (!db) throw new UsageError(`swarm ${sub}: --plan and --db are required`);
  const stateDir = import_node_path14.default.resolve(io.cwd, db, "state");
  const sessionsDir = import_node_path14.default.resolve(io.cwd, db, "sessions");
  if (!(0, import_node_fs13.existsSync)(stateDir) || !(0, import_node_fs13.existsSync)(sessionsDir)) throw new UsageError(`swarm ${sub}: --db must hold the state and sessions listings`);
  const states = readDocs(stateDir);
  const sessions = readDocs(sessionsDir);
  const integrated = [];
  for (const t of plan.tasks) {
    if (states[t.id]?.status !== "done") continue;
    for (const c of states[t.id]?.commits ?? []) {
      if (typeof c?.sha === "string" && ID.test(c.sha) && deps.git(["merge-base", "--is-ancestor", c.sha, e.branch]) !== null) integrated.push(c.sha);
    }
  }
  return { plan, states, sessions, integrated };
}
var LOCAL_STATE = [":!.forge", ":!.waypoint", ":!.claude"];
var baselineFile = (cacheDir, key, sha) => import_node_path14.default.join(cacheDir, "baseline", `${key}-${sha}.json`);
function readBaseline(cacheDir, key, sha) {
  try {
    return JSON.parse((0, import_node_fs13.readFileSync)(baselineFile(cacheDir, key, sha), "utf8"));
  } catch {
    return null;
  }
}
var timedOut = (results) => Array.isArray(results) && results.some((r2) => Array.isArray(r2?.failures) && r2.failures.some((f) => typeof f === "string" && f.startsWith("timeout after")));
function writeBaseline(cacheDir, key, sha, results) {
  if (timedOut(results)) return;
  try {
    (0, import_node_fs13.mkdirSync)(import_node_path14.default.join(cacheDir, "baseline"), { recursive: true });
    (0, import_node_fs13.writeFileSync)(baselineFile(cacheDir, key, sha), JSON.stringify(results));
  } catch {
  }
}
function mergeIn(at, ref, message, scope, timeoutSec, configRoot, cacheDir, target) {
  const key = `${scope}-${target}`;
  const merging = () => at.git(["rev-parse", "-q", "--verify", "MERGE_HEAD"]) !== null;
  if (merging()) return { result: "dirty", detail: "an unfinished merge is in progress there (git merge --abort to clear it)" };
  const dirty = at.git(["status", "--porcelain", "--", ".", ...LOCAL_STATE]);
  if (dirty === null || dirty.trim() !== "") return { result: "dirty", detail: "it has uncommitted changes" };
  if (at.git(["rev-parse", "--verify", "-q", `${ref}^{commit}`]) === null) return { result: "conflict", detail: `unknown ref ${ref}` };
  const pre = at.git(["rev-parse", "HEAD"])?.trim();
  if (!pre) return { result: "conflict", detail: "cannot read HEAD" };
  const rollback = (detail) => {
    const undone = at.git(["merge", "--abort"]) !== null;
    const clean = undone && at.git(["rev-parse", "HEAD"])?.trim() === pre && !merging();
    return { result: "conflict", detail: clean ? detail : `rollback failed: needs manual attention (${detail})` };
  };
  let baseline = readBaseline(cacheDir, key, pre);
  if (baseline === null) {
    try {
      const config0 = loadConfig(configRoot);
      baseline = runValidators(selectValidators(detectValidators(at.repo, config0), scope === "final" ? { mode: "final" } : { mode: "heavy", changed: null }), at.exec, timeoutSec);
      writeBaseline(cacheDir, key, pre, baseline);
    } catch {
      baseline = [];
    }
    const left = at.git(["status", "--porcelain", "--", ".", ...LOCAL_STATE]);
    if (left === null || left.trim() !== "") return { result: "dirty", detail: `the validators left changes in the worktree: ${(left ?? "").split(/\r?\n/).filter(Boolean).slice(0, 5).join(", ")}` };
  }
  if (at.git(["merge", "--no-ff", "--no-commit", ref]) === null) {
    if (!merging()) return { result: "conflict", detail: `git refused to merge ${ref}` };
    return rollback(`merge conflict with ${ref}`);
  }
  if (!merging()) return { result: "merged", sha: pre, preexisting: [] };
  let results;
  try {
    const config = loadConfig(configRoot);
    results = markPreexisting(runValidators(selectValidators(detectValidators(at.repo, config), scope === "final" ? { mode: "final" } : { mode: "heavy", changed: null }), at.exec, timeoutSec), baseline);
  } catch (err) {
    return rollback(`validators could not run: ${err.message}`);
  }
  const failed = results.filter(blocking);
  if (failed.length) return rollback(`validators failed after merging ${ref}: ${failed.map((r2) => r2.validator).join(", ")}`);
  if (at.git(["commit", "--no-edit", "-m", message]) === null || merging()) return rollback(`could not commit the merge of ${ref}`);
  const sha = at.git(["rev-parse", "HEAD"])?.trim() ?? "";
  if (!sha || sha === pre) return rollback(`could not commit the merge of ${ref}`);
  writeBaseline(cacheDir, key, sha, results);
  return { result: "merged", sha, preexisting: results.filter((r2) => r2.preexisting).map((r2) => r2.validator) };
}
function integrate(rest, io, deps) {
  const task = rest[0];
  if (!task || !isPlanId(task)) throw new UsageError("swarm integrate: a task id is required");
  const e = readExecution(io.cwd);
  if (!e) throw new UsageError("swarm integrate: no execution (forge swarm start)");
  const t = e.tasks[task];
  if (!t || t.status !== "accepted") throw new UsageError(`swarm integrate: ${task} is not accepted`);
  const at = io.now().toISOString();
  const out = (v) => ({ code: 0, stdout: JSON.stringify(v) + "\n", stderr: "" });
  const wt = e.kind === "plan" ? runWorktree(io.cwd) : io.cwd;
  const target = deps.at(wt);
  const head = target.git(["rev-parse", "--abbrev-ref", "HEAD"])?.trim();
  if (e.kind === "plan") {
    if (head !== e.branch) return out({ result: "run-dirty", detail: `${wt} is on ${head ?? "?"}, not ${e.branch}` });
  } else if (head !== e.branch) {
    throw new UsageError(`swarm integrate: the main checkout is on ${head ?? "?"}, not ${e.branch} (the branch this ephemeral run started from); switch back to ${e.branch} to integrate ${task}`);
  }
  const config = loadConfig(io.cwd);
  const r2 = mergeIn(target, t.branch, `forge: integrate ${task}`, "heavy", config.validatorTimeoutSec, wt, import_node_path14.default.join(io.cwd, ".forge", "execution"), "run");
  const cur = readExecution(io.cwd);
  if (r2.result === "dirty") return out({ result: "run-dirty", detail: r2.detail });
  const next = r2.result === "merged" ? { ...cur.tasks[task], status: "integrated", stage: "integrate", updatedAt: at, detail: null, finishedAt: at } : { ...cur.tasks[task], status: "conflict", detail: r2.detail, updatedAt: at };
  saveExecution(io.cwd, { ...cur, tasks: { ...cur.tasks, [task]: next } });
  return out(r2.result === "merged" ? { result: "integrated", sha: r2.sha, preexisting: r2.preexisting } : { result: "conflict", detail: r2.detail });
}
function mergeFinal(rest, io, deps) {
  const e = readExecution(io.cwd);
  if (!e) throw new UsageError("swarm merge: no execution (forge swarm start)");
  const out = (v) => ({ code: 0, stdout: JSON.stringify(v) + "\n", stderr: "" });
  if (e.kind !== "plan") return out({ result: "merged", sha: deps.git(["rev-parse", "HEAD"])?.trim() ?? "" });
  if (!e.mergeOnFinish && !rest.includes("--yes")) return out({ result: "needs-authorization" });
  const branch = deps.git(["rev-parse", "--abbrev-ref", "HEAD"])?.trim();
  if (branch !== e.base) return out({ result: "main-dirty", detail: `the main checkout is on ${branch ?? "?"}, not ${e.base}` });
  const config = loadConfig(io.cwd);
  const r2 = mergeIn(deps, e.branch, `forge: merge ${e.branch}`, "final", config.validatorTimeoutSec, io.cwd, import_node_path14.default.join(io.cwd, ".forge", "execution"), "main");
  if (r2.result === "dirty") return out({ result: "main-dirty", detail: `the main checkout ${r2.detail}` });
  return out(r2.result === "merged" ? { result: "merged", sha: r2.sha, preexisting: r2.preexisting } : { result: "conflict", detail: r2.detail });
}
function swarmCommand(args, io, deps) {
  const [sub, ...rest] = args;
  const flag = (name) => {
    const i = rest.indexOf(`--${name}`);
    const v = i >= 0 ? rest[i + 1] : void 0;
    return v === void 0 || v.startsWith("--") ? void 0 : v;
  };
  const has = (name) => rest.includes(`--${name}`);
  const json = (v) => ({ code: 0, stdout: JSON.stringify(v, null, 2) + "\n", stderr: "" });
  const ok = () => ({ code: 0, stdout: "ok\n", stderr: "" });
  const now = io.now();
  const iso3 = now.toISOString();
  const current = () => {
    const e = readExecution(io.cwd);
    if (!e) throw new UsageError(`swarm ${sub}: no execution (forge swarm start)`);
    return e;
  };
  if (["start", "tick", "integrate", "merge", "sleep", "worktree", "retry", "relaunch", "nudge", "takeover"].includes(sub ?? "") && !(sub === "worktree" && has("member"))) {
    const top = deps.git(["rev-parse", "--show-toplevel"])?.trim();
    const main = mainWorktreeFrom(deps.git(["worktree", "list", "--porcelain"]));
    if (!top || !main || !samePath(top, main)) {
      throw new UsageError(`swarm ${sub}: run it from the main checkout${main ? ` (${main})` : ""}, not from a worktree`);
    }
  }
  const taskArg = () => {
    const t = rest[0];
    if (!t || !isPlanId(t)) throw new UsageError(`swarm ${sub}: a task id is required`);
    return t;
  };
  const memberCtx = (needMember) => {
    const main = mainCheckout(io.cwd);
    const e = readExecution(main);
    if (!e?.active) throw new UsageError(`swarm ${sub}: no active execution`);
    if (e.kind === "ephemeral") throw new UsageError(`swarm ${sub}: an ephemeral run takes no members`);
    const session = flag("session") ?? flag("member");
    if (!session) throw new UsageError(`swarm ${sub}: --session is required`);
    if (!isMemberId(session)) throw new UsageError(`swarm ${sub}: --session ${session.slice(0, 130)} is not a valid session id (letters, digits, _ - .; max 120)`);
    const m = needMember ? readMember(main, session) : null;
    if (needMember && (!m || m.runId !== e.runId)) throw new UsageError(`swarm ${sub}: ${session} has not joined this execution`);
    return { main, e, session, m };
  };
  switch (sub) {
    case "join": {
      const { main, e, session } = memberCtx(false);
      if (session === e.coordinator || session === e.hookSession) throw new UsageError(`swarm join: ${session} coordinates this execution`);
      const role = flag("role");
      if (role !== "executor" && role !== "manual") throw new UsageError("swarm join: --role must be executor or manual");
      const task = flag("task") ?? null;
      if (task !== null && !isPlanId(task)) throw new UsageError("swarm join: --task is not a task id");
      if (role === "executor" && !task) throw new UsageError("swarm join: an executor needs --task");
      if (has("hook-session") && !flag("hook-session")) throw new UsageError("swarm join: --hook-session needs an id");
      const before = readMember(main, session);
      const given = flag("hook-session");
      const usable2 = given !== void 0 && isMemberId(given) ? given : null;
      const warning = given !== void 0 && usable2 === null ? `--hook-session ${given.slice(0, 130)} is not a usable session id (letters, digits, _ - .; max 120): joined without a live signal` : null;
      const hookSession = usable2 ?? (before?.runId === e.runId ? before.hookSession : null);
      if (hookSession !== null && hookSession === e.hookSession) throw new UsageError(`swarm join: ${hookSession} coordinates this execution`);
      writeMember(main, { sessionId: session, role, runId: e.runId, task, name: flag("name") ?? null, since: iso3, hookSession });
      return json({ runId: e.runId, role, task, coordinator: e.coordinator, branch: e.branch, mode: e.mode, project: e.project, ...warning ? { warning } : {} });
    }
    case "report": {
      const task = taskArg();
      const { main, e, session, m } = memberCtx(true);
      const member = m;
      if (member.role === "executor" && member.task !== task) throw new UsageError(`swarm report: ${session} executes ${member.task}, not ${task}`);
      const stage = flag("stage");
      if (!stage || !STAGES.includes(stage)) throw new UsageError(`swarm report: --stage must be one of ${STAGES.join("|")}`);
      const status = flag("status") ?? "running";
      if (!["running", "accepted", "blocked"].includes(status)) throw new UsageError("swarm report: --status must be running, accepted or blocked");
      const round = has("round") ? Number(flag("round")) : 0;
      if (!Number.isInteger(round) || round < 0 || round > 99) throw new UsageError("swarm report: --round must be an integer from 0 to 99");
      let prev = null;
      try {
        prev = normalizePublicTask(JSON.parse((0, import_node_fs13.readFileSync)(executionTaskFile(main, task), "utf8")));
      } catch {
        prev = null;
      }
      if (prev && prev.runId === e.runId && prev.by !== session && Date.parse(prev.leaseUntil) > now.getTime()) {
        throw new UsageError(`swarm report: ${task} is reported by ${prev.by} until ${prev.leaseUntil}`);
      }
      if (member.role === "manual" && member.task !== task) writeMember(main, { ...member, task });
      const since = prev && prev.by === session && prev.stage === stage && prev.runId === e.runId ? prev.since : iso3;
      const lease = flag("lease") && !Number.isNaN(Date.parse(flag("lease"))) ? flag("lease") : new Date(now.getTime() + LEASE_MINUTES * 6e4).toISOString();
      const p = { task, runId: e.runId, stage, status, agent: has("no-agent") ? null : flag("agent") ?? null, round, since, updatedAt: iso3, leaseUntil: lease, by: session, mode: member.role === "executor" ? "sessions" : "manual" };
      writePublicTask(main, p);
      return json(p);
    }
    case "next": {
      const { e, session } = memberCtx(true);
      const { plan, states, sessions, integrated } = readTickInput(io, deps, e, flag("plan"), flag("db"), "next");
      const running = Object.values(e.tasks).filter((t) => t.status === "running").length;
      const d = schedule({ plan, states, sessions, exec: { ...e, coordinator: session, parallel: Math.min(10, running + 1) }, integrated, now: now.getTime() });
      const start = d.actions.find((a) => a.type === "start");
      return json(start ? { task: start.task, reason: null } : { task: null, reason: d.next.stallReason ?? "nothing is ready" });
    }
    case "start": {
      const project = flag("project");
      const session = flag("session");
      if (!project || !ID.test(project) || !session || !ID.test(session)) throw new UsageError("swarm start: --project and --session are required");
      const config = loadConfig(io.cwd);
      let parallel = config.swarm.parallel;
      if (has("parallel")) {
        const v = Number(flag("parallel"));
        if (!Number.isInteger(v) || v < 1 || v > 10) throw new UsageError("swarm start: --parallel must be an integer from 1 to 10");
        parallel = v;
      }
      const kind = flag("kind") ?? "plan";
      if (kind !== "plan" && kind !== "ephemeral") throw new UsageError("swarm start: --kind must be plan or ephemeral");
      if (kind === "ephemeral" && flag("mode") === "sessions") throw new UsageError("swarm start: an ephemeral run is always subagents (sessions need a plan)");
      const mode = kind === "ephemeral" ? flag("mode") ?? "subagents" : flag("mode") ?? config.swarm.mode ?? "subagents";
      if (mode !== "subagents" && mode !== "sessions") throw new UsageError("swarm start: --mode must be subagents or sessions");
      const base = deps.git(["rev-parse", "--abbrev-ref", "HEAD"])?.trim();
      if (!base || base === "HEAD") throw new UsageError("swarm start: the main checkout must be on a branch");
      const prev = readExecution(io.cwd);
      if (prev?.active && prev.coordinator !== session) {
        const last = Date.parse(prev.lastStepAt ?? prev.startedAt);
        if (now.getTime() - last < TAKEOVER_MIN * 6e4) throw new UsageError(`swarm start: coordinator ${prev.coordinator} is active (last step ${prev.lastStepAt ?? prev.startedAt})`);
      }
      const branch = flag("branch") ?? runBranch(project);
      if (!isRunBranch(branch)) throw new UsageError("swarm start: --branch is not a valid branch name");
      if (!isMemberId(session)) throw new UsageError("swarm start: --session must use letters, digits, _ - . (at most 120)");
      if (!isSafeId(`${project}-${iso3.replace(/[:.]/g, "")}`)) throw new UsageError("swarm start: --project must use letters, digits, _ - .");
      if (kind === "ephemeral" && !isRunBranch(base)) throw new UsageError(`swarm start: the base branch ${base} is outside the run branch rule (letters, digits, _ - . /)`);
      let setup = null;
      let baseSync = null;
      const resume = !!prev && prev.active && prev.kind === kind && prev.project === project && prev.branch === (kind === "plan" ? branch : base);
      let loose = [];
      let ignoredTasks = false;
      const moves = [];
      if (prev?.active && !resume) {
        throw new UsageError(`swarm start: the execution ${prev.runId} is active (kind ${prev.kind}); finish it or stop it (forge stop) first; a request during it goes to that run`);
      }
      if (kind === "ephemeral") {
        if (resume && prev) {
          const doc = readLoose(io.cwd, prev.runId);
          if (!doc) throw new UsageError("swarm start: the ephemeral run lost .forge/loose.json");
          loose = doc.tasks;
          ignoredTasks = has("tasks");
        } else {
          loose = loadTasksArg(io, flag("tasks"), "start");
          for (const t of loose) {
            const dir = taskWorktree(io.cwd, t.id);
            if ((0, import_node_fs13.existsSync)(dir)) throw new UsageError(`swarm start: ${dir} already exists; remove it (git worktree remove) or use another id`);
            const tb = taskBranch(t.id);
            if (deps.git(["rev-parse", "--verify", "-q", `refs/heads/${tb}`]) === null) continue;
            if (deps.git(["merge-base", "--is-ancestor", tb, base]) === null) throw new UsageError(`swarm start: ${tb} has work not on ${base}; use another id`);
            moves.push(tb);
          }
        }
        if (!has("parallel")) parallel = Math.min(parallel, Math.max(1, widthOf(planOfLoose(loose))));
      }
      if (kind === "plan") {
        const wt = runWorktree(io.cwd);
        if (branch === base) throw new UsageError(`swarm start: ${branch} is the base branch (checked out in the main checkout); the run branch must be another one (omit --branch for ${runBranch(project)})`);
        const defaultBranch = deps.git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])?.trim().replace(/^origin\//, "") || (deps.git(["rev-parse", "--verify", "-q", "refs/heads/main"]) !== null ? "main" : deps.git(["rev-parse", "--verify", "-q", "refs/heads/master"]) !== null ? "master" : null);
        if (defaultBranch && branch === defaultBranch) throw new UsageError(`swarm start: ${branch} is the default branch; an execution never integrates into it directly`);
        const holder = worktreeHolding(deps.git(["worktree", "list", "--porcelain"]), branch);
        if (holder && !samePath(holder, wt)) throw new UsageError(`swarm start: ${branch} is checked out in another worktree (${holder}); pick another --branch`);
        if ((0, import_node_fs13.existsSync)(wt)) {
          const on = deps.at(wt).git(["rev-parse", "--abbrev-ref", "HEAD"])?.trim();
          if (on !== branch) throw new UsageError(`swarm start: ${wt} exists and is on ${on ?? "?"}, not ${branch}; switch it or remove it (git worktree remove)`);
        }
        const existed = deps.git(["rev-parse", "--verify", "-q", `refs/heads/${branch}`]) !== null;
        if (!existed && deps.git(["branch", branch, base]) === null) {
          throw new UsageError(`swarm start: cannot create ${branch} from ${base}`);
        }
        if (!(0, import_node_fs13.existsSync)(wt)) {
          if (deps.git(["worktree", "add", wt, branch]) === null) throw new UsageError(`swarm start: cannot add the worktree ${wt}`);
          setup = runSetup(deps, wt, io.cwd);
        }
        if (!existed) baseSync = "created";
        else if (!resume) {
          const at = deps.at(wt);
          const status = at.git(["status", "--porcelain", "--", ".", ...LOCAL_STATE]);
          const dirty = status === null || status.trim() !== "";
          const dirtyMsg = `swarm start: the run worktree ${wt} has uncommitted changes; commit or clean them before ${branch} is brought up to ${base}`;
          if (deps.git(["merge-base", "--is-ancestor", base, branch]) !== null) baseSync = "up-to-date";
          else if (deps.git(["merge-base", "--is-ancestor", branch, base]) !== null) {
            if (at.git(["merge", "--ff-only", base]) === null) throw new UsageError(dirty ? dirtyMsg : `swarm start: cannot fast-forward ${branch} to ${base}`);
            baseSync = "fast-forward";
          } else if (at.git(["merge", "--no-ff", base, "-m", `forge: bring ${base} into ${branch}`]) !== null) baseSync = "merged";
          else {
            at.git(["merge", "--abort"]);
            if (dirty) throw new UsageError(dirtyMsg);
            throw new UsageError(`swarm start: ${branch} has diverged from ${base} and they conflict; merge them by hand or remove ${branch}`);
          }
        }
      }
      const state = resume && prev ? { ...prev, parallel, mode, mergeOnFinish: prev.mergeOnFinish || has("merge-on-finish"), coordinator: session, hookSession: null, sleepUntil: null } : {
        runId: `${project}-${iso3.replace(/[:.]/g, "")}`,
        kind,
        mode,
        parallel,
        project,
        base,
        branch: kind === "plan" ? branch : base,
        mergeOnFinish: has("merge-on-finish"),
        coordinator: session,
        hookSession: null,
        active: true,
        stopReason: null,
        stallReason: null,
        startedAt: iso3,
        lastStepAt: null,
        lastBlockStep: null,
        sleepUntil: null,
        tasks: {}
      };
      if (!normalizeExecution(state)) throw new UsageError("swarm start: --project, --session and the run branch must use letters, digits, _ - . (and / in the branch), at most 120 characters");
      for (const tb of moves) {
        if (deps.git(["branch", "-D", tb]) === null) throw new UsageError(`swarm start: cannot delete ${tb}; if a worktree still holds it, run git worktree prune or remove that worktree (git worktree remove)`);
      }
      (0, import_node_fs13.rmSync)(stopFile(io.cwd), { force: true });
      saveExecution(io.cwd, state);
      if (kind === "ephemeral" && !resume) writeLoose(io.cwd, { runId: state.runId, tasks: loose });
      const looseOut = kind === "ephemeral" ? { loose: loose.length, ...ignoredTasks ? { ignoredTasks: true, message: `the ephemeral run ${state.runId} is resumed with its own ${loose.length} tasks; --tasks was ignored (start a new run for new requests once this one ends)` } : {} } : {};
      return json({ ...state, setup, baseSync, ...looseOut });
    }
    case "status": {
      const state = readExecution(io.cwd);
      return json({ present: state !== null, state });
    }
    case "propose": {
      const plan = !flag("plan") && has("tasks") ? planOfLoose(loadTasksArg(io, flag("tasks"), "propose")) : loadPlanArg(io, flag("plan"), "propose");
      const width = widthOf(plan);
      const config = loadConfig(io.cwd);
      const configured = config.swarm.mode ?? null;
      const parallel = width < 2 ? 1 : Math.min(config.swarm.parallel, width);
      const reasons = [`${plan.tasks.length} tasks`, `up to ${width} at once (dependencies and zones)`];
      return json({ width, configured, recommended: { mode: "subagents", parallel }, reasons });
    }
    case "worktree": {
      if (has("member")) {
        const task2 = taskArg();
        const { main, e: e2, session, m } = memberCtx(true);
        if (m.role === "executor" && m.task !== task2) throw new UsageError(`swarm worktree: ${session} executes ${m.task}, not ${task2}`);
        return json(addTaskWorktree(deps, main, task2, e2.branch));
      }
      const task = taskArg();
      const e = current();
      const { worktree: dir, branch, base, setup } = addTaskWorktree(deps, io.cwd, task, e.branch);
      const t = e.tasks[task] ?? { status: "running", stage: "brief", round: 0, worktree: dir, branch, executor: e.mode, attempts: 0, agent: null, startedAt: iso3, stageSince: iso3, updatedAt: iso3, detail: null };
      saveExecution(io.cwd, { ...e, tasks: { ...e.tasks, [task]: { ...t, worktree: dir, branch, updatedAt: iso3 } } });
      return json({ worktree: dir, branch, base, setup });
    }
    case "task": {
      const task = taskArg();
      const e = current();
      const prev = e.tasks[task];
      if (!prev) throw new UsageError(`swarm task: ${task} is not part of this execution`);
      if (has("drop")) {
        const { [task]: _dropped, ...tasks } = e.tasks;
        saveExecution(io.cwd, { ...e, tasks });
        (0, import_node_fs13.rmSync)(executionTaskFile(io.cwd, task), { force: true });
        return ok();
      }
      const stage = flag("stage") ?? prev.stage;
      if (!STAGES.includes(stage)) throw new UsageError(`swarm task: --stage must be one of ${STAGES.join("|")}`);
      const status = flag("status") ?? prev.status;
      if (!["running", "accepted", "blocked"].includes(status) && status !== prev.status) throw new UsageError("swarm task: --status must be running, accepted or blocked");
      let detail = prev.detail;
      if (flag("detail-file")) {
        try {
          detail = (0, import_node_fs13.readFileSync)(import_node_path14.default.resolve(io.cwd, flag("detail-file")), "utf8").trim().slice(0, 500) || null;
        } catch {
          throw new UsageError("swarm task: cannot read --detail-file");
        }
      }
      const round = has("round") ? Number(flag("round")) : prev.round;
      if (!Number.isInteger(round) || round < 0 || round > 99) throw new UsageError("swarm task: --round must be an integer from 0 to 99");
      const agent = has("no-agent") ? null : flag("agent") ?? prev.agent;
      const stageSince = prev.stage !== stage ? iso3 : prev.stageSince;
      const finishedAt = status === "blocked" && prev.status !== "blocked" ? iso3 : status === "running" && prev.finishedAt ? null : prev.finishedAt;
      const next = { ...prev, stage, status, round, agent, detail, updatedAt: iso3, stageSince, ...finishedAt !== void 0 ? { finishedAt } : {} };
      saveExecution(io.cwd, { ...e, tasks: { ...e.tasks, [task]: next } });
      const lease = flag("lease") && !Number.isNaN(Date.parse(flag("lease"))) ? flag("lease") : new Date(now.getTime() + LEASE_MINUTES * 6e4).toISOString();
      writePublicTask(io.cwd, { task, runId: e.runId, stage, status, agent, round, since: stageSince, updatedAt: iso3, leaseUntil: lease, by: e.coordinator, mode: prev.executor });
      if (prev.stage !== stage) appendEvent(io.cwd, { ts: iso3, kind: "phase", task, phase: stage });
      return json(next);
    }
    case "tick": {
      const e = current();
      if (!e.active) throw new UsageError("swarm tick: the execution is not active");
      const input = e.kind === "ephemeral" ? (() => {
        const loose = readLoose(io.cwd, e.runId);
        if (!loose) throw new UsageError("swarm tick: the ephemeral run has no .forge/loose.json");
        return { plan: planOfLoose(loose.tasks), states: statesOfLoose(e), sessions: {}, integrated: [] };
      })() : readTickInput(io, deps, e, flag("plan"), flag("db"), "tick");
      const { plan, states, sessions, integrated } = input;
      const publicTasks = {};
      try {
        for (const f of (0, import_node_fs13.readdirSync)(import_node_path14.default.join(io.cwd, ".forge", "execution")).filter((n) => n.endsWith(".json")).slice(0, 500)) {
          try {
            const p = normalizePublicTask(JSON.parse((0, import_node_fs13.readFileSync)(import_node_path14.default.join(io.cwd, ".forge", "execution", f), "utf8")));
            if (p && `${p.task}.json` === f) publicTasks[p.task] = p;
          } catch {
          }
        }
      } catch {
      }
      let agents = null;
      if (flag("agents")) {
        let raw;
        try {
          raw = JSON.parse((0, import_node_fs13.readFileSync)(import_node_path14.default.resolve(io.cwd, flag("agents")), "utf8"));
        } catch {
          throw new UsageError("swarm tick: cannot read --agents");
        }
        if (!Array.isArray(raw)) throw new UsageError("swarm tick: --agents must be a JSON array of {name, state}");
        agents = raw.filter((a) => !!a && typeof a === "object" && typeof a.name === "string" && (a.state === "working" || a.state === "idle")).slice(0, 100);
      }
      const d = schedule({ plan, states, sessions, exec: e, integrated, now: now.getTime(), publicTasks, agents });
      saveExecution(io.cwd, d.next);
      return json({ actions: d.actions, running: Object.values(d.next.tasks).filter((t) => t.status === "running").length, parallel: e.parallel });
    }
    case "retry": {
      const task = taskArg();
      const e = current();
      const t = e.tasks[task];
      if (has("adopt")) {
        if (!t || t.status !== "conflict" || t.executor === "subagents") {
          throw new UsageError(`swarm retry: --adopt takes a member's task in conflict (${task} is ${t ? `${t.status}, ${t.executor}` : "not in this execution"})`);
        }
        if (deps.git(["rev-parse", "--verify", "-q", `refs/heads/${t.branch}`]) === null) throw new UsageError(`swarm retry: ${t.branch} does not exist`);
        const holder = worktreeHolding(deps.git(["worktree", "list", "--porcelain"]), t.branch);
        if (holder !== null) {
          const status = deps.at(holder).git(["status", "--porcelain"]);
          if (status === null) throw new UsageError(`swarm retry: could not read the worktree status of ${t.branch} (${holder}); check it by hand before --adopt`);
          if (status.trim() !== "") {
            throw new UsageError(`swarm retry: the worktree of ${t.branch} (${holder}) has uncommitted changes; commit or discard them before --adopt`);
          }
        }
        const worktree = holder ?? addTaskWorktree(deps, io.cwd, task, e.branch).worktree;
        const revive2 = !e.active && e.stopReason === "stalled";
        saveExecution(io.cwd, {
          ...e,
          ...revive2 ? { active: true, stopReason: null, stallReason: null } : {},
          tasks: { ...e.tasks, [task]: { ...t, status: "running", stage: "implement", executor: "subagents", worktree, attempts: t.attempts + 1, nudgedAt: null, finishedAt: iso3, updatedAt: iso3, stageSince: iso3 } }
        });
        writePublicTask(io.cwd, { task, runId: e.runId, stage: "implement", status: "running", agent: null, round: t.round, since: iso3, updatedAt: iso3, leaseUntil: new Date(now.getTime() + LEASE_MINUTES * 6e4).toISOString(), by: e.coordinator, mode: "subagents" });
        return json({ task, adopted: true, previous: t.executor, worktree, branch: t.branch });
      }
      if (!t || t.status !== "conflict" && t.status !== "blocked") throw new UsageError(`swarm retry: ${task} is not in conflict or blocked`);
      const revive = !e.active && e.stopReason === "stalled";
      saveExecution(io.cwd, {
        ...e,
        ...revive ? { active: true, stopReason: null, stallReason: null } : {},
        tasks: { ...e.tasks, [task]: { ...t, status: "running", stage: "implement", attempts: t.attempts + 1, detail: null, finishedAt: null, updatedAt: iso3, stageSince: iso3 } }
      });
      return ok();
    }
    case "relaunch":
    case "nudge": {
      const task = taskArg();
      const e = current();
      const t = e.tasks[task];
      if (!t || t.status !== "running" || t.executor !== "sessions") throw new UsageError(`swarm ${sub}: ${task} is not a running sessions task`);
      const planArg = flag("plan");
      if (has("plan") && (!planArg || planArg.startsWith("-"))) throw new UsageError(`swarm ${sub}: --plan needs a file`);
      if (planArg) {
        const isFile = (() => {
          try {
            return (0, import_node_fs13.statSync)(import_node_path14.default.resolve(io.cwd, planArg)).isFile();
          } catch {
            return false;
          }
        })();
        if (planArg.startsWith("-") || !isFile) throw new UsageError(`swarm ${sub}: --plan ${planArg} is not a plan file`);
      }
      if (sub === "nudge") {
        const es2 = (planArg ? loadPlanArg(io, planArg, "nudge").locale : planLocale(io.cwd, e.project)) === "es";
        const text = es2 ? `[forge run] ${task}: contin\xFAa con ${t.stage}; si est\xE1s bloqueado, m\xE1rcalo como bloqueado` : `[forge run] ${task}: continue with ${t.stage}; if you are blocked, mark it blocked`;
        saveExecution(io.cwd, { ...e, tasks: { ...e.tasks, [task]: { ...t, nudgedAt: iso3 } } });
        return json({ task, name: `wp-${e.project}-${task}`, text });
      }
      const planPath = planArg;
      if (!planPath) throw new UsageError("swarm relaunch: --plan is required");
      const verdict = relaunchOrBlock(task, t.attempts);
      if (verdict.type === "block") {
        saveExecution(io.cwd, { ...e, tasks: { ...e.tasks, [task]: { ...t, status: "blocked", detail: verdict.reason, updatedAt: iso3, finishedAt: iso3 } } });
        return json({ task, blocked: true, reason: verdict.reason });
      }
      const attempt = verdict.attempt;
      const log = deps.git(["log", "--oneline", "-n", "20", `${e.branch}..${t.branch}`])?.trim();
      const commits = log ? log.split(/\r?\n/).map((l) => `  - ${l}`).join("\n") : "  - none";
      const note = import_node_path14.default.join(io.cwd, ".forge", "work", task, "handover.md");
      const memberWork = import_node_path14.default.join(t.worktree || taskWorktree(io.cwd, task), ".forge", "work", task);
      (0, import_node_fs13.mkdirSync)(import_node_path14.default.dirname(note), { recursive: true });
      (0, import_node_fs13.writeFileSync)(note, [
        `# Handover: ${task} (attempt ${attempt} of ${RELAUNCH_CAP + 1})`,
        "",
        `- Run: ${e.runId} \xB7 coordinator ${e.coordinator} \xB7 run branch ${e.branch}`,
        `- Last stage: ${t.stage} \xB7 round ${t.round} \xB7 agent ${t.agent ?? "none"} \xB7 since ${t.stageSince}`,
        `- Detail: ${t.detail ?? "none"}`,
        `- Commits on ${t.branch} not yet on ${e.branch}:`,
        commits,
        "",
        `- This note: ${note} (main checkout ${io.cwd})`,
        `- Work files of the earlier attempts: ${memberWork} (the brief is brief-<n>.md there, with report-<n>.txt, validators-<n>.json and reviews-<n>-<round>/)`,
        "",
        `Resume from ${t.branch} in this worktree: read the brief in ${memberWork} if it exists (else write it as the brief stage says), do not redo a step whose output file is already written, and continue from the last stage.`,
        ""
      ].join("\n"));
      saveExecution(io.cwd, { ...e, tasks: { ...e.tasks, [task]: { ...t, attempts: attempt, startedAt: iso3, nudgedAt: null, updatedAt: iso3 } } });
      return json({ task, attempt, note, launch: ["launch", planPath, task, "--task", "--run", e.runId, "--coordinator", e.coordinator, "--base", e.branch] });
    }
    case "sleep": {
      const seconds = Number(rest[0]);
      if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_SLEEP_S) throw new UsageError(`swarm sleep: seconds must be an integer from 1 to ${MAX_SLEEP_S}`);
      const e = current();
      const until = new Date(now.getTime() + seconds * 1e3).toISOString();
      saveExecution(io.cwd, { ...e, sleepUntil: until });
      if (has("mark")) return ok();
      (io.sleep ?? sleepSync)(seconds * 1e3);
      const after = readExecution(io.cwd);
      if (after && after.sleepUntil === until) saveExecution(io.cwd, { ...after, sleepUntil: null });
      return ok();
    }
    case "stop": {
      const reason = flag("reason") ?? "stopped";
      if (reason !== "stopped" && reason !== "budget") throw new UsageError("swarm stop: --reason must be stopped or budget");
      const e = readExecution(io.cwd);
      if (e?.active) saveExecution(io.cwd, { ...e, active: false, stopReason: reason, sleepUntil: null });
      return ok();
    }
    case "takeover": {
      const session = flag("session");
      if (!session) throw new UsageError("swarm takeover: --session is required");
      if (!isMemberId(session)) throw new UsageError(`swarm takeover: --session ${session.slice(0, 130)} is not a valid session id (letters, digits, _ - .; max 120)`);
      const e = current();
      if (!e.active) throw new UsageError("swarm takeover: the execution is not active");
      if (session === e.coordinator || session === e.hookSession) {
        if (e.coordinator !== session || e.hookSession !== null) saveExecution(io.cwd, { ...e, coordinator: session, hookSession: null });
        return json({ took: "already", runId: e.runId });
      }
      if (readMember(io.cwd, session)?.runId === e.runId) throw new UsageError(`swarm takeover: ${session} is a member of the execution ${e.runId}; a run member cannot take over the coordinator`);
      const previous = e.hookSession ?? e.coordinator;
      const order = ["stopped", "silent", "alive"];
      const seen = [];
      if (isSafeId(previous)) try {
        const d = normalizeLive(JSON.parse((0, import_node_fs13.readFileSync)(liveFile(io.cwd, previous), "utf8")));
        if (d) seen.push(signalLiveness(d.ts, d.ended, now.getTime()));
      } catch {
      }
      if (flag("db") && isSafeId(e.coordinator)) {
        try {
          seen.push(sessionLiveness(JSON.parse((0, import_node_fs13.readFileSync)(import_node_path14.default.resolve(io.cwd, flag("db"), "sessions", `${e.coordinator}.json`), "utf8")), now.getTime()));
        } catch {
        }
      }
      if (!seen.length) seen.push(now.getTime() - Date.parse(e.lastStepAt ?? e.startedAt) >= TAKEOVER_MIN * 6e4 ? "stopped" : "alive");
      const liveness2 = seen.reduce((a, b) => order.indexOf(b) > order.indexOf(a) ? b : a, "stopped");
      if (liveness2 !== "stopped") return json({ took: false, previous, liveness: liveness2, joinAs: "manual" });
      saveExecution(io.cwd, { ...e, coordinator: session, hookSession: null, sleepUntil: null });
      appendEvent(io.cwd, { ts: iso3, kind: "decision", what: "takeover", previous, by: session });
      return json({ took: true, previous, runId: e.runId, running: Object.entries(e.tasks).filter(([, t]) => t.status === "running").map(([id2]) => id2) });
    }
    case "integrate":
      return integrate(rest, io, deps);
    case "merge":
      return mergeFinal(rest, io, deps);
    default:
      throw new UsageError("usage: forge swarm <start --project P --session SID [--mode M] [--parallel N] [--merge-on-finish] [--branch B] [--kind plan|ephemeral] [--tasks F]|status|propose --plan P|--tasks F|worktree <T>|task <T> --stage S [--agent A|--no-agent] [--round N] [--status S] [--detail-file F] [--lease ISO]|task <T> --drop|tick [--plan P --db DIR] [--agents F]|relaunch <T> --plan P|nudge <T> [--plan P]|integrate <T>|merge|retry <T> [--adopt]|sleep <seconds> [--mark]|stop [--reason stopped|budget]|join --session SID --role executor|manual [--task T] [--name N] [--hook-session ID]|report <T> --session SID --stage S [--agent A|--no-agent] [--round N] [--status S] [--lease ISO]|worktree <T> --member SID|next --plan P --db DIR --session SID|takeover --session SID [--db DIR]>");
  }
}

// src/forge/tools.ts
function checkTools(names2, deps) {
  const tools = {};
  for (const n of [...new Set(names2)]) tools[n] = n.endsWith("-mcp") ? "unknown" : deps.onPath(n) ? "found" : "missing";
  const report = { tools };
  if (tools.adb === "found") {
    const r2 = deps.exec("adb devices", 5);
    report.adb = { devices: r2.code === 0 && !r2.timedOut ? r2.output.split(/\r?\n/).map((l) => l.trim().split(/\s+/)).filter((p) => p.length === 2 && p[1] === "device").map((p) => p[0]) : [] };
  }
  return report;
}
var missingTools = (names2, onPath2) => [...new Set(names2)].filter((n) => !n.endsWith("-mcp") && !onPath2(n));

// src/forge/verify.ts
var firstMatch = (globs, changed) => changed?.find((f) => globs.some((g) => globMatch(g, f)));
function verifyPlan(i) {
  if ((i.path === "trivial" || i.path === "small") && !i.asked) return { eligible: false, surfaces: [], drafts: [], reason: `${i.path}: no tool verification unless the task asks for it` };
  const surfaces = [];
  for (const s2 of i.surfaces) {
    const perm = i.local.surfaces[s2.name];
    if (perm?.state === "denied") continue;
    let match = null;
    if (s2.affects !== null) {
      const m = firstMatch(s2.affects, i.changed);
      if (m === void 0) continue;
      match = m;
    }
    const permission = perm?.state !== "allowed" ? "ask" : perm.hash === s2.hash ? "allowed" : "changed";
    surfaces.push({ name: s2.name, permission, match, missing: i.missing(s2) });
  }
  const drafts = i.drafts.filter((d) => !i.surfaces.some((s2) => s2.name === d.name) && !i.local.proposed.includes(d.name)).flatMap((d) => {
    const m = firstMatch(d.affects, i.changed);
    return m === void 0 ? [] : [{ name: d.name, match: m }];
  });
  const eligible = surfaces.some((s2) => s2.permission === "allowed");
  const reason = i.changed === null ? "the diff is unknown: only surfaces without affects are candidates" : surfaces.length ? surfaces.map((s2) => `${s2.name}${s2.match ? ` (${s2.match})` : ""}`).join(", ") : "no surface matches the diff";
  return { eligible, surfaces, drafts, reason };
}
function cleanupPids(pids, kill, protect = [process.pid, process.ppid]) {
  const killed = [], gone = [];
  for (const pid of pids) (pid > 1 && !protect.includes(pid) && kill(pid) ? killed : gone).push(pid);
  return { killed, gone };
}
var killTarget = (pid, pgid) => pgid === pid ? -pid : pid;

// src/forge/surfaces.ts
var import_node_crypto2 = require("node:crypto");
var import_node_fs14 = require("node:fs");
var import_node_path15 = __toESM(require("node:path"), 1);
var import_yaml4 = __toESM(require_dist(), 1);
function surfaceHash(text) {
  return (0, import_node_crypto2.createHash)("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex").slice(0, 16);
}
var strs = (x) => Array.isArray(x) ? x.filter((s2) => typeof s2 === "string" && s2.trim() !== "") : [];
var surfaceFile = (name) => `.forge/verify/${name}.md`;
function parseSurface(name, text) {
  const t = text.replace(/\r\n/g, "\n");
  const out = { name, file: surfaceFile(name), title: name, affects: null, tools: [], hash: surfaceHash(text) };
  let body = t;
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(t);
  if (m) {
    body = t.slice(m[0].length);
    try {
      const h = (0, import_yaml4.parse)(m[1]);
      if (h && typeof h === "object" && !Array.isArray(h)) {
        const o = h;
        if (Array.isArray(o.affects)) out.affects = strs(o.affects);
        out.tools = strs(o.tools);
      } else if (h !== null) out.error = "header is not a mapping";
    } catch (e) {
      out.error = `header: ${e.message.split("\n")[0]}`;
    }
  }
  const title = /^#\s+(.+)$/m.exec(body);
  if (title) out.title = title[1].trim();
  return out;
}
function readSurfaces(root) {
  let names2 = [];
  try {
    names2 = (0, import_node_fs14.readdirSync)(import_node_path15.default.join(root, ".forge", "verify"));
  } catch {
    return [];
  }
  return names2.filter((f) => f.endsWith(".md") && NAME.test(f.slice(0, -3))).sort().map((f) => {
    const name = f.slice(0, -3);
    let text = "";
    try {
      text = (0, import_node_fs14.readFileSync)(import_node_path15.default.join(root, ".forge", "verify", f), "utf8");
    } catch {
    }
    return parseSurface(name, text);
  });
}
var WEB_DEPS = ["vite", "next", "react-scripts", "@angular/core", "svelte", "vue", "astro"];
var WEB_AFFECTS = ["**/*.tsx", "**/*.jsx", "**/*.vue", "**/*.svelte", "**/*.html", "**/*.css", "**/*.scss", "**/pages/**", "**/routes/**", "**/components/**", "**/views/**", "**/app/**"];
function detectDrafts(repo) {
  const out = [];
  let pkg = {};
  try {
    pkg = JSON.parse(repo.read("package.json") ?? "{}") ?? {};
  } catch {
    pkg = {};
  }
  const deps = { ...pkg.dependencies ?? {}, ...pkg.devDependencies ?? {} };
  const scripts = pkg.scripts ?? {};
  const script = ["dev", "start"].find((s2) => typeof scripts[s2] === "string");
  if (script && WEB_DEPS.some((d) => d in deps)) {
    out.push({ name: "web", affects: WEB_AFFECTS, tools: ["chrome-mcp"], body: `# Web

Start the app with \`npm run ${script}\` and open the URL it prints. Check it with the browser MCP (Chrome or Playwright), or the Playwright CLI.
` });
  }
  const android = ["capacitor.config.ts", "capacitor.config.js", "capacitor.config.json"].some((f) => repo.exists(f)) || ["android/app/build.gradle", "android/app/build.gradle.kts", "app/build.gradle", "app/build.gradle.kts"].some((f) => /com\.android\.application/.test(repo.read(f) ?? ""));
  if (android) {
    const capacitor = ["capacitor.config.ts", "capacitor.config.js", "capacitor.config.json"].some((f) => repo.exists(f));
    out.push({ name: "android", affects: capacitor ? ["android/**", ...WEB_AFFECTS] : ["android/**", "**/res/**", "**/*.kt", "**/*.java"], tools: ["adb"], body: `# Android

Build the debug app${capacitor ? " (`npx cap sync android` first)" : ""}, install it on a running emulator or device with \`adb install -r\`, launch it and check the screens the change touches with screenshots (\`adb exec-out screencap -p\`).
` });
  }
  if (repo.list("ios").some((f) => /\.(xcodeproj|xcworkspace)$/.test(f))) {
    out.push({ name: "ios", affects: ["ios/**"], tools: ["xcrun"], body: "# iOS\n\nBuild the app for a simulator and launch it with `xcrun simctl`; check the screens the change touches with `xcrun simctl io booted screenshot`.\n" });
  }
  if (repo.exists("pubspec.yaml")) {
    out.push({ name: "flutter", affects: ["lib/**"], tools: ["flutter"], body: "# Flutter\n\nRun the app with `flutter run` on an emulator or device and check the screens the change touches with screenshots.\n" });
  }
  if ("electron" in deps || "@tauri-apps/api" in deps) {
    out.push({ name: "desktop", affects: ["src/**"], tools: [], body: "# Desktop\n\nStart the desktop app in development mode and check the windows the change touches with screenshots.\n" });
  }
  return out;
}
var HEADING = /^##\s+(Learned|Aprendido)\s*$/;
function bodyLines(t) {
  const out = [];
  let pos = 0;
  const hdr = /^---\n[\s\S]*?\n---[ \t]*(\n|$)/.exec(t);
  if (hdr) pos = hdr[0].length;
  let fence = false;
  for (const text of t.slice(pos).split("\n")) {
    if (/^\s*(```|~~~)/.test(text)) fence = !fence;
    else if (!fence) out.push({ text, at: pos });
    pos += text.length + 1;
  }
  return out;
}
function appendLearned(text, date, notes, heading = "Learned") {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = notes.map((n) => `- ${date}: ${n.replace(/\s*\r?\n\s*/g, " ").trim()}`);
  const t = text.replace(/\r\n/g, "\n");
  const bl = bodyLines(t);
  const hi = bl.findIndex((l) => HEADING.test(l.text));
  let next;
  let count2;
  if (hi >= 0) {
    const start = bl[hi].at + bl[hi].text.length;
    const endLine = bl.slice(hi + 1).find((l) => /^## /.test(l.text));
    const section = t.slice(start, endLine ? endLine.at : void 0);
    const kept = section.replace(/\n+$/, "");
    count2 = (kept.match(/^- /gm) ?? []).length + lines.length;
    next = `${t.slice(0, start)}${kept}
${lines.join("\n")}
${endLine ? "\n" + t.slice(endLine.at) : ""}`;
  } else {
    const head = t.replace(/\n+$/, "");
    next = `${head}${head ? "\n\n" : ""}## ${heading}
${lines.join("\n")}
`;
    count2 = lines.length;
  }
  return { text: eol === "\n" ? next : next.replace(/\n/g, "\r\n"), count: count2 };
}

// src/forge/cli/run.ts
var USAGE = "usage: forge <triage|brief|validate|verdict|round|log|agents|last|proposals|surfaces|tools|local|verify-plan|verify-cleanup|waypoint-cli|infinite|cycle|swarm|stop|hook> ...";
var MAX_OUTPUT = 4 * 1024 * 1024;
var MAX_GIT_OUTPUT = 256 * 1024 * 1024;
function readTail(fd) {
  const size = (0, import_node_fs15.fstatSync)(fd).size;
  const len = Math.min(size, MAX_OUTPUT);
  const buf = Buffer.alloc(len);
  let off = 0;
  while (off < len) {
    const n = (0, import_node_fs15.readSync)(fd, buf, off, len - off, size - len + off);
    if (n <= 0) break;
    off += n;
  }
  const text = buf.subarray(0, off).toString("utf8");
  return size > MAX_OUTPUT ? `[output truncated]
${text}` : text;
}
var TIMEOUT_EXIT = 124;
var WRAPPER_SOURCE = `
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const [cmd, ms, log] = process.argv.slice(1);
const win = process.platform === 'win32';
const fd = fs.openSync(log, 'a');
let timedOut = false;
const child = spawn(cmd, { shell: true, stdio: ['ignore', fd, fd], detached: !win, windowsHide: true });
const timer = setTimeout(() => {
  timedOut = true;
  try { fs.writeFileSync(log + '.timeout', ''); } catch {}
  try {
    if (win) execFileSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { stdio: 'ignore', windowsHide: true });
    else process.kill(-child.pid, 'SIGKILL');
  } catch {}
  process.exit(${TIMEOUT_EXIT});
}, Number(ms));
child.on('error', e => { clearTimeout(timer); try { fs.writeSync(fd, 'spawn error: ' + e.message + require('os').EOL); } catch {} process.exit(127); });
child.on('exit', code => { clearTimeout(timer); if (!timedOut) process.exit(code === null ? 1 : code); });
`;
function defaultExec(cwd2) {
  return (cmd, timeoutSec) => {
    const t0 = Date.now();
    const timeoutMs = timeoutSec * 1e3;
    let dir;
    let fd;
    try {
      dir = (0, import_node_fs15.mkdtempSync)(import_node_path16.default.join((0, import_node_os.tmpdir)(), "forge-exec-"));
      const file = import_node_path16.default.join(dir, "out.log");
      fd = (0, import_node_fs15.openSync)(file, "w+");
      const r2 = (0, import_node_child_process2.spawnSync)(process.execPath, ["-e", WRAPPER_SOURCE, "--", cmd, String(timeoutMs), file], {
        cwd: cwd2,
        windowsHide: true,
        timeout: timeoutMs + 15e3,
        stdio: ["ignore", "ignore", "pipe"],
        encoding: "utf8",
        maxBuffer: 64 * 1024
      });
      const err = r2.error;
      const timedOut2 = err?.code === "ETIMEDOUT" || r2.status === TIMEOUT_EXIT && (0, import_node_fs15.existsSync)(`${file}.timeout`);
      let output = readTail(fd);
      if (r2.stderr) output += `${output && !output.endsWith("\n") ? "\n" : ""}${r2.stderr}`;
      if (err && !timedOut2) output += `${output && !output.endsWith("\n") ? "\n" : ""}${err.message}
`;
      return { code: r2.status ?? 1, output, ms: Date.now() - t0, timedOut: timedOut2 };
    } catch (e) {
      return { code: 1, output: `forge: could not run the command: ${e.message}
`, ms: Date.now() - t0, timedOut: false };
    } finally {
      if (fd !== void 0) {
        try {
          (0, import_node_fs15.closeSync)(fd);
        } catch {
        }
      }
      if (dir !== void 0) {
        try {
          (0, import_node_fs15.rmSync)(dir, { recursive: true, force: true });
        } catch {
        }
      }
    }
  };
}
function defaultGit(cwd2) {
  return (args) => {
    try {
      return (0, import_node_child_process2.execFileSync)("git", args, { cwd: cwd2, encoding: "utf8", maxBuffer: MAX_GIT_OUTPUT, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      return null;
    }
  };
}
var repoReader = (root) => ({
  exists: (rel) => (0, import_node_fs15.existsSync)(import_node_path16.default.join(root, rel)),
  read: (rel) => {
    try {
      return (0, import_node_fs15.readFileSync)(import_node_path16.default.join(root, rel), "utf8");
    } catch {
      return null;
    }
  },
  list: (dir) => {
    try {
      return (0, import_node_fs15.readdirSync)(import_node_path16.default.join(root, dir ?? ""));
    } catch {
      return [];
    }
  }
});
function planTask(cwd2, planArg, id2) {
  if (!planArg || !id2) throw new UsageError("--plan and --task are required");
  let text;
  try {
    text = (0, import_node_fs15.readFileSync)(import_node_path16.default.resolve(cwd2, planArg), "utf8");
  } catch {
    throw new UsageError(`cannot read plan ${planArg}`);
  }
  let plan;
  try {
    plan = parsePlan(text);
  } catch (e) {
    if (e instanceof PlanError) throw new UsageError(`${planArg}: ${e.issues.join("; ")}`);
    throw e;
  }
  const task = plan.tasks.find((t) => t.id === id2);
  if (!task) throw new UsageError(`task ${id2} is not in ${planArg}`);
  return { plan, task };
}
function findWaypointCli(scriptPath) {
  const forgeRoot = import_node_path16.default.resolve(import_node_path16.default.dirname(scriptPath), "..");
  const dev = import_node_path16.default.join(forgeRoot, "..", "waypoint", "dist", "waypoint.cjs");
  if ((0, import_node_fs15.existsSync)(dev)) return import_node_path16.default.resolve(dev);
  const base = import_node_path16.default.join(forgeRoot, "..", "..", "waypoint");
  let versions = [];
  try {
    versions = (0, import_node_fs15.readdirSync)(base);
  } catch {
    return null;
  }
  const key = (v) => v.split(/[.+-]/).map((n) => /^\d+$/.test(n) ? Number(n) : 0);
  const cmp = (a, b) => {
    const x = key(a), y = key(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const d = (x[i] ?? 0) - (y[i] ?? 0);
      if (d) return d;
    }
    return 0;
  };
  for (const v of versions.sort((a, b) => cmp(b, a))) {
    const f = import_node_path16.default.join(base, v, "dist", "waypoint.cjs");
    if ((0, import_node_fs15.existsSync)(f)) return import_node_path16.default.resolve(f);
  }
  return null;
}
function stopContext(cwd2, now) {
  const proposals = loadProposals(cwd2);
  return {
    now,
    stopFile: (0, import_node_fs15.existsSync)(stopFile(cwd2)),
    approvedPending: proposals.filter(isActionable).length,
    pendingProposals: proposals.filter((p) => p.status === "proposed" || p.status === "discussing").length
  };
}
function hookStop(io) {
  try {
    const input = JSON.parse(io.stdin ?? "");
    if (!input || typeof input !== "object" || Array.isArray(input)) return "";
    const hookInput = input;
    const main = mainCheckout(io.cwd);
    const read = readExecution(main);
    const sid = typeof hookInput.session_id === "string" ? hookInput.session_id : null;
    const member = read?.active && sid ? memberForHook(main, sid, read.runId) : null;
    if (member) {
      hookLive(io, "Stop");
      return "";
    }
    const exec = bindHookSession(read, hookInput.session_id);
    if (exec && exec !== read) saveExecution(main, exec);
    hookLive(io, "Stop");
    const sleeping = !!exec?.active && !!exec.sleepUntil && Date.parse(exec.sleepUntil) > io.now().getTime();
    const run2 = parseRun(readRunText(io.cwd));
    if (run2?.active) {
      const d2 = decideStop(hookInput, run2, { ...stopContext(io.cwd, io.now()), ledgerEvents: readEvents(io.cwd).length, swarmSleeping: sleeping });
      if (!d2.block) return "";
      saveRun(io.cwd, d2.run);
      if (d2.ended) appendEvent(io.cwd, { ts: io.now().toISOString(), kind: "cycle", action: "stopped", reason: d2.ended });
      return JSON.stringify({ decision: "block", reason: d2.reason + replyIn(planLocale(io.cwd, exec?.project)) }) + "\n";
    }
    const d = decideExecutionStop(hookInput, exec, { now: io.now(), stopFile: (0, import_node_fs15.existsSync)(stopFile(main)) });
    if (!d.block) return "";
    saveExecution(main, d.exec);
    return JSON.stringify({ decision: "block", reason: d.reason + replyIn(planLocale(main, d.exec.project)) }) + "\n";
  } catch {
    return "";
  }
}
function run(argv, io) {
  const cwdAt = argv.indexOf("--cwd");
  if (cwdAt >= 0) {
    const dir = argv[cwdAt + 1];
    if (!dir || dir.startsWith("--")) return { code: 2, stdout: "", stderr: "forge: --cwd needs a directory\n" };
    const abs = import_node_path16.default.resolve(io.cwd, dir);
    if (!(0, import_node_fs15.existsSync)(abs)) return { code: 2, stdout: "", stderr: `forge: --cwd ${abs} does not exist
` };
    if (!(0, import_node_fs15.statSync)(abs).isDirectory()) return { code: 2, stdout: "", stderr: `forge: --cwd ${abs} is not a directory
` };
    argv = [...argv.slice(0, cwdAt), ...argv.slice(cwdAt + 2)];
    io = { ...io, workdir: abs, git: defaultGit(abs), exec: defaultExec(abs) };
  }
  const repoDir = io.workdir ?? io.cwd;
  const [cmd, ...args] = argv;
  const flag = (name) => {
    const i = args.indexOf(`--${name}`);
    const v = i >= 0 ? args[i + 1] : void 0;
    return v === void 0 || v.startsWith("--") ? void 0 : v;
  };
  const has = (name) => args.includes(`--${name}`);
  const ok = (out) => ({ code: 0, stdout: out.endsWith("\n") ? out : `${out}
`, stderr: "" });
  const json = (v, code = 0) => ({ code, stdout: JSON.stringify(v, null, 2) + "\n", stderr: "" });
  const ts = () => io.now().toISOString();
  try {
    switch (cmd) {
      case "log": {
        const kind = flag("kind");
        if (!kind || !LEDGER_KINDS.includes(kind)) throw new UsageError(`log: --kind must be one of ${LEDGER_KINDS.join("|")}`);
        let data = {};
        if (flag("data") !== void 0 && flag("data-file") !== void 0) throw new UsageError("log: use --data or --data-file, not both");
        if (flag("data") !== void 0 || flag("data-file") !== void 0) {
          const label = flag("data-file") !== void 0 ? "--data-file" : "--data";
          let parsed;
          try {
            const raw = flag("data-file") !== void 0 ? (0, import_node_fs15.readFileSync)(import_node_path16.default.resolve(io.cwd, flag("data-file")), "utf8") : flag("data");
            parsed = JSON.parse(raw);
          } catch {
            throw new UsageError(`log: ${label} must be a JSON object`);
          }
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new UsageError(`log: ${label} must be a JSON object`);
          data = parsed;
        }
        const task = flag("task");
        appendEvent(io.cwd, { ...data, ts: ts(), kind, ...task ? { task } : {} });
        return ok("ok");
      }
      case "brief": {
        const { plan, task } = planTask(io.cwd, flag("plan"), flag("task"));
        const design = flag("design") ?? import_node_path16.default.join(import_node_path16.default.dirname(flag("plan")), "design.md");
        const designPath = (0, import_node_fs15.existsSync)(import_node_path16.default.resolve(io.cwd, design)) ? design.replace(/\\/g, "/") : null;
        return ok(renderBrief(plan, task, { planPath: flag("plan").replace(/\\/g, "/"), designPath }));
      }
      case "triage": {
        const textArgs = [...args];
        for (const f of ["--task", "--text-file", "--plan"]) {
          const i = textArgs.indexOf(f);
          if (i >= 0) textArgs.splice(i, 2);
        }
        let task = textArgs.filter((a) => !a.startsWith("--")).join(" ").trim();
        if (flag("text-file") !== void 0) {
          try {
            task = (0, import_node_fs15.readFileSync)(import_node_path16.default.resolve(io.cwd, flag("text-file")), "utf8").trim();
          } catch {
            throw new UsageError("triage: cannot read --text-file");
          }
        }
        if (has("plan") && flag("plan") === void 0) throw new UsageError("triage: --plan needs a plan file");
        const planned = flag("plan") !== void 0 ? planTask(io.cwd, flag("plan"), flag("task")).task : null;
        if (planned) task = taskText(planned);
        if (!task) throw new UsageError("triage: the task text is required");
        const git = io.git ?? defaultGit(io.cwd);
        const lines = (out) => (out ?? "").split("\n").map((s2) => s2.trim()).filter(Boolean);
        const listed = git(["-c", "core.quotePath=false", "ls-files"]);
        const commits = Number.parseInt((git(["rev-list", "--count", "HEAD"]) ?? "").trim(), 10) || 0;
        const bookkeeping = (f) => /^(docs\/waypoint|docs\/superpowers|\.forge|\.waypoint)\//.test(f);
        const grep = (w) => lines(git(["-c", "core.quotePath=false", "grep", "-l", "-I", "--fixed-strings", "-w", "-e", w])).filter((f) => !bookkeeping(f));
        const tracked = lines(listed);
        const zoneFiles = planned ? tracked.filter((f) => planned.zones.some((z) => globMatch(z, f))) : [];
        const extra = planned ? { files: zoneFiles, zones: zonesFromPaths(planned.zones) } : void 0;
        const catalog = detectValidators(repoReader(repoDir), loadConfig(repoDir)).map((v) => ({ name: v.name, cmd: v.cmd, kind: v.kind, source: v.source }));
        const names2 = catalog.map((v) => v.name);
        const result = triage(task, { files: tracked, commits, gitOk: listed !== null, grep }, names2, extra);
        if (planned?.zones.length && !zoneFiles.length) result.reasons.push("zones match no tracked file (new files?)");
        if (flag("task")) {
          const rank = (p) => PATH_ORDER.indexOf(p);
          const prior = readEvents(io.cwd).filter((e) => e.kind === "triage" && e.task === flag("task") && rank(e.path) >= 0).reduce((max, e) => max === null || rank(e.path) > rank(max) ? e.path : max, null);
          if (prior && rank(prior) > rank(result.path)) {
            result.path = prior;
            result.reasons.push(`ratchet: kept ${prior} from an earlier triage of this task`);
          }
        }
        const impl = implementerFor(result, task, { batch: has("batch") });
        const implementer = { ...impl, agent: impl.role ? agentFor(impl.role, loadConfig(repoDir).profile) : null };
        const known = readLocal(io.cwd).known;
        const fresh = names2.filter((n) => !known.includes(n));
        if (fresh.length || known.some((n) => !names2.includes(n))) updateLocal(io.cwd, (s2) => ({ ...s2, known: names2 }));
        appendEvent(io.cwd, { ts: ts(), kind: "triage", ...flag("task") ? { task: flag("task") } : {}, ...result });
        return json({ ...result, catalog, new: fresh, implementer });
      }
      case "validate": {
        const config = loadConfig(repoDir);
        const all = detectValidators(repoReader(repoDir), config);
        const p = flag("path");
        if (p !== void 0 && !PATH_ORDER.includes(p)) throw new UsageError(`validate: --path must be one of ${PATH_ORDER.join("|")}`);
        let scope;
        if (has("final")) scope = { mode: "final" };
        else if (!has("all") && flag("affected") !== void 0) scope = { mode: "affected", files: flag("affected").split(",").map((s2) => s2.trim()).filter(Boolean) };
        else if (p === "trivial" || p === "small") scope = { mode: "small" };
        else {
          const base = flag("base");
          const diff = base ? (io.git ?? defaultGit(io.cwd))(["diff", "--name-only", `${base}..HEAD`]) : null;
          scope = { mode: "heavy", changed: diff === null ? null : diff.split("\n").map((s2) => s2.trim()).filter(Boolean) };
        }
        const list = selectValidators(all, scope);
        let results = runValidators(list, io.exec ?? defaultExec(io.cwd), config.validatorTimeoutSec);
        if (has("baseline")) {
          if (flag("baseline") === void 0) throw new UsageError("validate: --baseline needs the JSON a validate run printed on the base commit");
          let baseline;
          try {
            baseline = JSON.parse((0, import_node_fs15.readFileSync)(import_node_path16.default.resolve(io.cwd, flag("baseline")), "utf8"));
          } catch {
            throw new UsageError("validate: --baseline must be the JSON written by forge validate");
          }
          results = markPreexisting(results, baseline);
        }
        const allOk = results.every((r2) => !blocking(r2));
        appendEvent(io.cwd, { ts: ts(), kind: "validate", ...flag("task") ? { task: flag("task") } : {}, ...has("base-run") ? { baseline: true } : {}, ok: allOk, results: results.map((r2) => ({ validator: r2.validator, ok: r2.ok, flaky: r2.flaky, ...r2.skipped ? { skipped: r2.skipped } : {}, ...r2.preexisting ? { preexisting: true } : {}, ...r2.ok ? {} : { failures: r2.failures } })) });
        const out = json(results, allOk ? 0 : 1);
        if (!list.length) out.stderr = all.length ? "no validators cover the affected paths\n" : "no validators detected: add tests or list validators in .forge/config.yaml\n";
        return out;
      }
      case "verdict": {
        const task = flag("task");
        const dirArg = flag("dir");
        if (!task || !dirArg) throw new UsageError("verdict: --task and --dir are required");
        const dir = import_node_path16.default.resolve(io.cwd, dirArg);
        const reviews = {};
        for (const name of ["correctness", "security", "perf"]) {
          const file = import_node_path16.default.join(dir, `${name}.json`);
          if ((0, import_node_fs15.existsSync)(file)) reviews[name] = parseReview((0, import_node_fs15.readFileSync)(file, "utf8"));
        }
        const verifyPath = import_node_path16.default.join(dir, "verify.json");
        const verifyFile = (0, import_node_fs15.existsSync)(verifyPath) ? parseVerifyFile((0, import_node_fs15.readFileSync)(verifyPath, "utf8")) : void 0;
        if (verifyFile !== void 0) reviews.verify = verifyReview(verifyFile);
        if (!Object.keys(reviews).length) throw new UsageError(`no reviews found in ${dirArg}`);
        let validatorsOk;
        let failing = [];
        let preexisting = [];
        let recorded = true;
        if (flag("validators")) {
          let results;
          try {
            results = JSON.parse((0, import_node_fs15.readFileSync)(import_node_path16.default.resolve(io.cwd, flag("validators")), "utf8"));
          } catch {
            throw new UsageError("verdict: --validators must be the JSON written by forge validate");
          }
          const arr = Array.isArray(results) ? results : [];
          validatorsOk = Array.isArray(results) && arr.every((r2) => r2 && typeof r2 === "object" && !blocking(r2));
          failing = arr.filter((r2) => r2 && typeof r2 === "object" && blocking(r2)).map((r2) => ({ validator: String(r2.validator ?? ""), failures: Array.isArray(r2.failures) ? r2.failures.map(String) : [] }));
          preexisting = arr.filter((r2) => r2 && typeof r2 === "object" && r2.ok !== true && r2.preexisting === true).map((r2) => String(r2.validator ?? ""));
        } else {
          const lastValidate = [...readEvents(io.cwd)].reverse().find((e) => e.kind === "validate" && e.task === task && e.baseline !== true);
          recorded = lastValidate !== void 0;
          validatorsOk = lastValidate?.ok === true;
          const rs = Array.isArray(lastValidate?.results) ? lastValidate.results : [];
          failing = rs.filter((r2) => r2 && blocking(r2)).map((r2) => ({ validator: String(r2.validator ?? ""), failures: Array.isArray(r2.failures) ? r2.failures.map(String) : [] }));
          preexisting = rs.filter((r2) => r2 && r2.ok !== true && r2.preexisting === true).map((r2) => String(r2.validator ?? ""));
        }
        const result = synthesize(reviews, weightsFor({ sensitive: has("sensitive"), perf: has("perf") }), validatorsOk, failing);
        if (!recorded) result.reasons.push("no validation recorded");
        if (preexisting.length) result.reasons.push(`already failing on the base commit, not counted: ${preexisting.join(", ")}`);
        appendEvent(io.cwd, {
          ts: ts(),
          kind: "verdict",
          task,
          dir: import_node_path16.default.relative(io.cwd, dir).split(import_node_path16.default.sep).join("/") || ".",
          action: result.action,
          score: result.score,
          signature: result.signature,
          critical: result.critical.length,
          important: result.important.length,
          minor: result.minor.length
        });
        if (verifyFile !== void 0) {
          const rel = import_node_path16.default.relative(io.cwd, dir).split(import_node_path16.default.sep).join("/");
          const evidence = rel.replace(/reviews-(\d+-\d+)$/, "evidence/$1");
          appendEvent(io.cwd, {
            ts: ts(),
            kind: "verify",
            task,
            result: verifyFile?.result ?? "invalid",
            passed: verifyFile ? verifyFile.checks.filter((c) => c.ok).length : 0,
            total: verifyFile ? verifyFile.checks.length : 0,
            ...evidence !== rel ? { evidence } : {},
            ...verifyFile?.reason ? { reason: verifyFile.reason } : {}
          });
        }
        return json(result);
      }
      case "verify-cleanup": {
        const dir = flag("dir");
        if (!dir) throw new UsageError("verify-cleanup: --dir is required");
        let pids = [];
        try {
          const raw = JSON.parse((0, import_node_fs15.readFileSync)(import_node_path16.default.resolve(io.cwd, dir, "pids.json"), "utf8"));
          if (Array.isArray(raw)) pids = raw.filter((p) => Number.isInteger(p));
        } catch {
          pids = [];
        }
        const pgid = (pid) => {
          try {
            const n = Number((0, import_node_child_process2.execFileSync)("ps", ["-o", "pgid=", "-p", String(pid)], { encoding: "utf8", timeout: 5e3, stdio: ["ignore", "pipe", "ignore"] }).trim());
            return Number.isInteger(n) && n > 0 ? n : null;
          } catch {
            return null;
          }
        };
        const kill = (pid) => {
          try {
            if (process.platform === "win32") (0, import_node_child_process2.execFileSync)("taskkill", ["/T", "/F", "/PID", String(pid)], { stdio: "ignore", windowsHide: true });
            else process.kill(killTarget(pid, pgid(pid)), "SIGTERM");
            return true;
          } catch {
            try {
              process.kill(pid, "SIGTERM");
              return true;
            } catch {
              return false;
            }
          }
        };
        return json(cleanupPids(pids, kill));
      }
      case "round": {
        const task = flag("task");
        const p = flag("path");
        if (!task || p !== "medium" && p !== "large") throw new UsageError("round: --task and --path medium|large are required");
        const verdicts = readEvents(io.cwd).filter((e) => e.kind === "verdict" && e.task === task && (e.action === "accept" || e.action === "fix" || e.action === "redo"));
        const lastPerDir = /* @__PURE__ */ new Map();
        verdicts.forEach((e, i) => {
          if (typeof e.dir === "string") lastPerDir.set(e.dir, i);
        });
        const history = verdicts.filter((e, i) => typeof e.dir !== "string" || lastPerDir.get(e.dir) === i).map((e) => ({ action: e.action, score: typeof e.score === "number" ? e.score : null, signature: String(e.signature ?? "") }));
        const d = decideRound(history, p);
        appendEvent(io.cwd, { ts: ts(), kind: "round", task, ...d });
        return json(d);
      }
      case "proposals": {
        const [sub, ...rest] = args;
        const subFlag = (name) => {
          const i = rest.indexOf(`--${name}`);
          const v = i >= 0 ? rest[i + 1] : void 0;
          return v === void 0 || v.startsWith("--") ? void 0 : v;
        };
        const writeOf = (d, by, at) => {
          const w = { status: d.status, decidedBy: by, decidedAt: at };
          if (d.reason) w.reason = d.reason;
          return w;
        };
        const readText = (f, what) => {
          try {
            return (0, import_node_fs15.readFileSync)(import_node_path16.default.resolve(io.cwd, f), "utf8");
          } catch {
            throw new UsageError(`proposals: cannot read ${what}`);
          }
        };
        switch (sub) {
          case "add": {
            const file = subFlag("file");
            if (!file) throw new UsageError("proposals add: --file is required");
            let raw;
            try {
              raw = JSON.parse(readText(file, "--file"));
            } catch (e) {
              if (e instanceof UsageError) throw e;
              throw new UsageError("proposals add: --file must be a JSON object");
            }
            if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new UsageError("proposals add: --file must be a JSON object");
            const o = raw;
            const doc = normalizeProposal({ ...o, ts: typeof o.ts === "string" ? o.ts : ts(), status: "proposed", decidedBy: void 0, decidedAt: void 0, reason: void 0, taskId: void 0, author: subFlag("author") ?? o.author ?? "session" });
            if (!doc) throw new UsageError("proposals add: invalid proposal (category, risk, title and source are required and must be valid)");
            if (doc.source === "scout" && (!doc.pillar?.trim() || !doc.evidence?.trim())) throw new UsageError("proposals add: a scout proposal needs a pillar and evidence");
            const existing = loadProposals(io.cwd);
            const hit = similarRejected(doc, existing.filter((p) => p.status === "rejected"));
            if (hit) return { code: 3, stdout: "", stderr: `proposals add: similar to rejected proposal ${hit} and without new evidence
` };
            const revises = subFlag("revises");
            if (has("revises") && (!revises || !PROPOSAL_ID.test(revises))) throw new UsageError("proposals add: --revises needs a proposal id");
            const open = similarOpen(doc, existing.filter((p) => p.id !== revises));
            if (open) return { code: 3, stdout: "", stderr: `proposals add: similar to open proposal ${open}
` };
            const id2 = proposalId(io.now(), io.rand ?? Math.random);
            saveProposal(io.cwd, id2, doc);
            appendEvent(io.cwd, { ts: ts(), kind: "proposal", action: "add", id: id2 });
            return json({ id: id2, doc });
          }
          case "list": {
            const status = subFlag("status");
            if (status !== void 0 && !PROPOSAL_STATUSES.includes(status)) throw new UsageError(`proposals list: --status must be one of ${PROPOSAL_STATUSES.join("|")}`);
            const all = loadProposals(io.cwd).filter((p) => status === void 0 || p.status === status);
            all.sort((a, b) => a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : a.id < b.id ? 1 : -1);
            return json(all);
          }
          case "decide": {
            const [id2, action] = rest;
            if (!id2 || !PROPOSAL_ID.test(id2)) throw new UsageError("proposals decide: a proposal id (p + 14 digits + 4 letters/digits) is required");
            if (action !== "approve" && action !== "reject" && action !== "discuss") throw new UsageError("proposals decide: action must be approve|reject|discuss");
            const rf = subFlag("reason-file");
            const reason = rf !== void 0 ? readText(rf, "--reason-file").trim() : void 0;
            const by = subFlag("by") ?? "user";
            const at = ts();
            const from = subFlag("from");
            if (from !== void 0) {
              let base;
              try {
                base = normalizeProposal(JSON.parse(readText(from, "--from")));
              } catch (e) {
                if (e instanceof UsageError) throw e;
                base = null;
              }
              if (!base) throw new UsageError("proposals decide: --from must be a valid proposal doc");
              const r3 = decideDoc(base, action, by, at, reason || void 0);
              if (!r3.ok) throw new UsageError(`proposals decide: ${id2} is already decided`);
              return json({ id: id2, status: r3.doc.status, write: writeOf(r3.doc, by, at) });
            }
            const r2 = decideLocal(io.cwd, id2, action, by, at, reason || void 0);
            if (!r2.ok) throw new UsageError(r2.error === "missing" ? `proposals decide: ${id2} not found` : `proposals decide: ${id2} is already decided`);
            appendEvent(io.cwd, { ts: at, kind: "proposal", action: "decide", id: id2, status: r2.doc.status });
            return json({ id: id2, status: r2.doc.status, write: writeOf(r2.doc, by, at) });
          }
          case "save": {
            const from = subFlag("from");
            if (!from) throw new UsageError("proposals save: --from is required");
            const id2 = subFlag("id") ?? import_node_path16.default.basename(from).replace(/(\.db)?\.json$/, "");
            if (!PROPOSAL_ID.test(id2)) throw new UsageError("proposals save: a proposal id (p + 14 digits + 4 letters/digits) is required (--id, or a <id>.json / <id>.db.json file name)");
            let doc;
            try {
              doc = normalizeProposal(JSON.parse(readText(from, "--from")));
            } catch (e) {
              if (e instanceof UsageError) throw e;
              doc = null;
            }
            if (!doc) throw new UsageError("proposals save: --from must be a valid proposal doc");
            const { previous } = mirrorProposal(io.cwd, id2, doc);
            const logged = (previous ?? "proposed") !== doc.status;
            if (logged) appendEvent(io.cwd, { ts: ts(), kind: "proposal", action: "decide", id: id2, status: doc.status });
            return json({ id: id2, status: doc.status, previous, logged });
          }
          case "pull": {
            const dir = subFlag("dir");
            if (!dir) throw new UsageError("proposals pull: --dir is required");
            const abs = import_node_path16.default.resolve(io.cwd, dir);
            let names2;
            if (!(0, import_node_fs15.existsSync)(abs)) return ok("0");
            try {
              names2 = (0, import_node_fs15.readdirSync)(abs);
            } catch {
              throw new UsageError(`proposals pull: cannot read ${dir}`);
            }
            let n = 0;
            for (const name of names2.sort()) {
              if (!name.endsWith(".json")) continue;
              const id2 = name.slice(0, -5);
              if (!PROPOSAL_ID.test(id2)) continue;
              let doc;
              try {
                doc = normalizeProposal(JSON.parse((0, import_node_fs15.readFileSync)(import_node_path16.default.join(abs, name), "utf8")));
              } catch {
                continue;
              }
              if (!doc) continue;
              saveProposal(io.cwd, id2, doc);
              n++;
            }
            return ok(String(n));
          }
          case "policy": {
            const id2 = rest[0];
            if (!id2 || !PROPOSAL_ID.test(id2)) throw new UsageError("proposals policy: a proposal id is required");
            const found = loadProposals(io.cwd).find((p) => p.id === id2);
            if (!found) throw new UsageError(`proposals policy: ${id2} not found`);
            const { id: _id, ...doc } = found;
            if (doc.status !== "proposed" || !autoApprovable(doc)) {
              appendEvent(io.cwd, { ts: ts(), kind: "proposal", action: "policy", id: id2, status: doc.status });
              return json({ id: id2, status: doc.status, write: null });
            }
            const at = ts();
            saveProposal(io.cwd, id2, { ...doc, status: "auto_approved", decidedBy: "forge:policy", decidedAt: at });
            appendEvent(io.cwd, { ts: at, kind: "proposal", action: "policy", id: id2, status: "auto_approved" });
            return json({ id: id2, status: "auto_approved", write: { status: "auto_approved", decidedBy: "forge:policy", decidedAt: at } });
          }
          case "to-task": {
            const id2 = rest[0];
            if (!id2 || !PROPOSAL_ID.test(id2)) throw new UsageError("proposals to-task: a proposal id is required");
            const planArg = subFlag("plan");
            if (!planArg) throw new UsageError("proposals to-task: --plan is required");
            const found = loadProposals(io.cwd).find((p) => p.id === id2);
            if (!found) throw new UsageError(`proposals to-task: ${id2} not found`);
            if (!isActionable(found)) throw new UsageError(`proposals to-task: ${id2} is not approved`);
            if (found.taskId !== void 0) throw new UsageError(`proposals to-task: ${id2} already has task ${found.taskId}`);
            const text = readText(planArg, "--plan");
            let plan;
            try {
              plan = parsePlan(text);
            } catch (e) {
              if (e instanceof PlanError) throw new UsageError(`${planArg}: ${e.issues.join("; ")}`);
              throw e;
            }
            const { task, phase } = proposalToTask(plan, found, { track: subFlag("track") });
            const ydoc = (0, import_yaml5.parseDocument)(text);
            if (phase) ydoc.addIn(["phases"], ydoc.createNode(phase));
            ydoc.addIn(["tasks"], ydoc.createNode(task));
            const next = String(ydoc);
            try {
              parsePlan(next);
            } catch (e) {
              if (e instanceof PlanError) throw new UsageError(`proposals to-task: the resulting plan is invalid: ${e.issues.join("; ")}`);
              throw e;
            }
            (0, import_node_fs15.writeFileSync)(import_node_path16.default.resolve(io.cwd, planArg), next);
            const { id: _id, ...doc } = found;
            saveProposal(io.cwd, id2, { ...doc, taskId: task.id });
            appendEvent(io.cwd, { ts: ts(), kind: "proposal", action: "to-task", id: id2, taskId: task.id });
            return json({ id: id2, taskId: task.id, write: { taskId: task.id } });
          }
          default:
            throw new UsageError("usage: forge proposals <add|list|decide|save|pull|policy|to-task> ...");
        }
      }
      case "surfaces": {
        const [sub] = args;
        if (sub === void 0 || sub.startsWith("--")) {
          const surfaces = readSurfaces(io.cwd);
          const local = readLocal(io.cwd);
          const drafts = detectDrafts(repoReader(repoDir)).filter((d) => !surfaces.some((s2) => s2.name === d.name) && !local.proposed.includes(d.name));
          return json({ surfaces, drafts });
        }
        const name = flag("name");
        if (!name || !NAME.test(name)) throw new UsageError(`surfaces ${sub}: --name must match ${NAME}`);
        if (sub === "proposed") {
          updateLocal(io.cwd, (s2) => ({ ...s2, proposed: [.../* @__PURE__ */ new Set([...s2.proposed, name])] }));
          return ok("ok");
        }
        if (sub === "learn") {
          const file = import_node_path16.default.join(io.cwd, surfaceFile(name));
          if (!(0, import_node_fs15.existsSync)(file)) throw new UsageError(`surfaces learn: ${surfaceFile(name)} does not exist`);
          if ((0, import_node_fs15.lstatSync)(file).isSymbolicLink()) throw new UsageError(`surfaces learn: ${surfaceFile(name)} is a symlink`);
          let notes;
          try {
            notes = JSON.parse((0, import_node_fs15.readFileSync)(import_node_path16.default.resolve(io.cwd, flag("notes-file") ?? ""), "utf8"));
          } catch {
            throw new UsageError("surfaces learn: --notes-file must be a JSON array of strings");
          }
          if (!Array.isArray(notes) || !notes.every((n) => typeof n === "string" && n.trim())) throw new UsageError("surfaces learn: --notes-file must be a JSON array of strings");
          const before = (0, import_node_fs15.readFileSync)(file, "utf8");
          const r2 = appendLearned(before, ts().slice(0, 10), notes, flag("heading") ?? "Learned");
          (0, import_node_fs15.writeFileSync)(file, r2.text);
          const cur = readLocal(io.cwd).surfaces[name];
          if (cur && cur.state === "allowed" && cur.hash === surfaceHash(before)) updateLocal(io.cwd, (s2) => ({ ...s2, surfaces: { ...s2.surfaces, [name]: { ...cur, hash: surfaceHash(r2.text) } } }));
          return json({ name, count: r2.count });
        }
        throw new UsageError("usage: forge surfaces [learn --name N --notes-file F [--heading H] | proposed --name N]");
      }
      case "tools": {
        const all = readSurfaces(io.cwd);
        const one = flag("surface");
        const picked = one === void 0 ? all : all.filter((s2) => s2.name === one);
        if (one !== void 0 && !picked.length) throw new UsageError(`tools: no surface ${one} in .forge/verify/`);
        return json(checkTools(picked.flatMap((s2) => s2.tools), { onPath, exec: io.exec ?? defaultExec(io.cwd) }));
      }
      case "verify-plan": {
        const task = flag("task"), p = flag("path"), base = flag("base");
        if (!task || !p || !base) throw new UsageError("verify-plan: --task, --path and --base are required");
        if (!PATH_ORDER.includes(p)) throw new UsageError(`verify-plan: --path must be one of ${PATH_ORDER.join("|")}`);
        const diff = (io.git ?? defaultGit(io.cwd))(["diff", "--name-only", `${base}..HEAD`]);
        const plan = verifyPlan({
          path: p,
          asked: has("asked"),
          changed: diff === null ? null : diff.split("\n").map((s2) => s2.trim()).filter(Boolean),
          surfaces: readSurfaces(io.cwd),
          drafts: detectDrafts(repoReader(repoDir)),
          local: readLocal(io.cwd),
          missing: (s2) => missingTools(s2.tools, onPath)
        });
        appendEvent(io.cwd, { ts: ts(), kind: "verify", task, planned: plan.eligible, surfaces: plan.surfaces.filter((s2) => s2.permission === "allowed").map((s2) => s2.name) });
        return json(plan);
      }
      case "local": {
        const [sub, key, value] = args;
        if (sub === "get") {
          const s2 = readLocal(io.cwd);
          if (key === void 0) return json(s2);
          const m = /^surfaces\.(.+)$/.exec(key);
          if (!m) throw new UsageError("local get: the path must be surfaces.<name>");
          return json(s2.surfaces[m[1]] ?? null);
        }
        if (sub === "set") {
          const m = /^surfaces\.(.+)$/.exec(key ?? "");
          if (!m || !NAME.test(m[1])) throw new UsageError("local set: the path must be surfaces.<name>");
          if (value !== "allowed" && value !== "denied" && value !== "none") throw new UsageError("local set: the value must be allowed|denied|none");
          const surface = readSurfaces(io.cwd).find((x) => x.name === m[1]);
          if (value === "allowed" && !surface) throw new UsageError(`local set: .forge/verify/${m[1]}.md does not exist`);
          updateLocal(io.cwd, (s2) => {
            const surfaces = { ...s2.surfaces };
            if (value === "none") delete surfaces[m[1]];
            else surfaces[m[1]] = { state: value, hash: value === "allowed" ? surface.hash : null };
            return { ...s2, surfaces };
          });
          return ok("ok");
        }
        throw new UsageError("usage: forge local get [surfaces.<name>] | set surfaces.<name> allowed|denied|none");
      }
      case "swarm":
        return swarmCommand(args, io, {
          git: io.git ?? defaultGit(io.cwd),
          exec: io.exec ?? defaultExec(io.cwd),
          repo: repoReader(repoDir),
          at: (dir) => ({ git: defaultGit(dir), exec: defaultExec(dir), repo: repoReader(dir) })
        });
      case "hook": {
        return { code: 0, stdout: args[0] === "stop" ? hookStop(io) : args[0] === "live" ? hookLive(io) : "", stderr: "" };
      }
      case "infinite": {
        const sub = args[0];
        if (sub === "start") {
          const num3 = (name, valid, what) => {
            if (!has(name)) return void 0;
            const v = flag(name);
            const n = v !== void 0 && /^\d+(\.\d+)?$/.test(v) ? Number(v) : NaN;
            if (!valid(n)) throw new UsageError(`infinite start: --${name} must be ${what}`);
            return n;
          };
          const posInt = (n) => Number.isInteger(n) && n > 0;
          const cycles = num3("cycles", posInt, "a positive integer");
          const hours = num3("hours", (n) => Number.isFinite(n) && n > 0, "a positive number");
          const queueMax = num3("queue-max", posInt, "a positive integer");
          const session = flag("session");
          if (has("session") && !session) throw new UsageError("infinite start: --session needs a session id");
          if (cycles === void 0 && hours === void 0) throw new UsageError("infinite start: a budget is required (--cycles N and/or --hours H)");
          const current = parseRun(readRunText(io.cwd));
          if (current?.active && stopReason(current, stopContext(io.cwd, io.now())) === null) throw new UsageError("infinite start: a run is already active (forge stop, or forge infinite status)");
          forgeDir(io.cwd);
          (0, import_node_fs15.rmSync)(stopFile(io.cwd), { force: true });
          const run2 = startRun(io.now(), { ...cycles !== void 0 ? { cycles } : {}, ...hours !== void 0 ? { hours } : {} }, queueMax, session ?? null);
          saveRun(io.cwd, run2);
          return json(run2);
        }
        if (sub === "status") {
          const text = readRunText(io.cwd);
          const run2 = parseRun(text);
          const reason = run2?.active ? stopReason(run2, stopContext(io.cwd, io.now())) : null;
          return json({ present: text !== null, valid: run2 !== null, run: run2, stopReason: reason });
        }
        throw new UsageError("usage: forge infinite <start --cycles N|--hours H [--queue-max N] [--session ID]|status>");
      }
      case "cycle": {
        const progress = flag("progress");
        if (progress !== "yes" && progress !== "no") throw new UsageError("cycle: --progress yes|no is required");
        let error;
        if (flag("error-file") !== void 0) {
          try {
            error = (0, import_node_fs15.readFileSync)(import_node_path16.default.resolve(io.cwd, flag("error-file")), "utf8");
          } catch {
            throw new UsageError("cycle: cannot read --error-file");
          }
        }
        const current = parseRun(readRunText(io.cwd));
        if (!current?.active) throw new UsageError("cycle: no active run (forge infinite start)");
        const next = recordCycle(current, { progress: progress === "yes", ...error !== void 0 ? { error } : {} });
        saveRun(io.cwd, next);
        appendEvent(io.cwd, { ts: ts(), kind: "cycle", cycle: next.cycle, progress: progress === "yes", ...next.lastError ? { error: next.lastError } : {} });
        return json(next);
      }
      case "stop": {
        forgeDir(io.cwd);
        (0, import_node_fs15.writeFileSync)(stopFile(io.cwd), `${ts()}
`);
        const current = parseRun(readRunText(io.cwd));
        if (current?.active) {
          saveRun(io.cwd, endRun(current, "stopped"));
          appendEvent(io.cwd, { ts: ts(), kind: "cycle", action: "stopped", reason: "stopped" });
        }
        const exec = readExecution(io.cwd);
        if (exec?.active) saveExecution(io.cwd, { ...exec, active: false, stopReason: "stopped", sleepUntil: null });
        return ok("ok");
      }
      case "waypoint-cli": {
        const found = findWaypointCli(io.scriptPath ?? process.argv[1] ?? "");
        if (!found) throw new UsageError("waypoint-cli: waypoint.cjs not found next to this forge install; is the waypoint plugin installed?");
        return ok(found);
      }
      case "agents": {
        const { profile } = loadConfig(io.cwd);
        return json({ profile, agents: Object.fromEntries(ROLES.map((r2) => [r2, agentFor(r2, profile)])) });
      }
      case "last": {
        const task = flag("task");
        if (!task) throw new UsageError("last: --task is required");
        const events = readEvents(io.cwd).filter((e) => e.task === task);
        const lastOf = (kind) => [...events].reverse().find((e) => e.kind === kind);
        return json({
          task,
          path: lastOf("triage")?.path ?? null,
          phase: lastOf("phase") ?? null,
          verdict: lastOf("verdict") ?? null,
          round: lastOf("round") ?? null,
          events: events.length
        });
      }
      default:
        return { code: 2, stdout: "", stderr: `${USAGE}
` };
    }
  } catch (e) {
    if (e instanceof UsageError || e instanceof ConfigError) return { code: 2, stdout: "", stderr: `${e.message}
` };
    return { code: 1, stdout: "", stderr: `forge: ${e.message}
` };
  }
}

// src/forge/cli/main.ts
var cwd = process.cwd();
var stdin = "";
if (process.argv[2] === "hook" && !process.stdin.isTTY) {
  try {
    stdin = (0, import_node_fs16.readFileSync)(0, "utf8");
  } catch {
    stdin = "";
  }
}
var r = run(process.argv.slice(2), { cwd, stdin, now: () => /* @__PURE__ */ new Date(), exec: defaultExec(cwd), git: defaultGit(cwd) });
process.stdout.write(r.stdout);
process.stderr.write(r.stderr);
process.exitCode = r.code;
