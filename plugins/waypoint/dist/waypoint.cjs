#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
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
    var ALIAS = /* @__PURE__ */ Symbol.for("yaml.alias");
    var DOC = /* @__PURE__ */ Symbol.for("yaml.document");
    var MAP = /* @__PURE__ */ Symbol.for("yaml.map");
    var PAIR = /* @__PURE__ */ Symbol.for("yaml.pair");
    var SCALAR = /* @__PURE__ */ Symbol.for("yaml.scalar");
    var SEQ = /* @__PURE__ */ Symbol.for("yaml.seq");
    var NODE_TYPE = /* @__PURE__ */ Symbol.for("yaml.node.type");
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
    var BREAK = /* @__PURE__ */ Symbol("break visit");
    var SKIP = /* @__PURE__ */ Symbol("skip children");
    var REMOVE = /* @__PURE__ */ Symbol("remove node");
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
    function visit_(key, node, visitor, path11) {
      const ctrl = callVisitor(key, node, visitor, path11);
      if (identity.isNode(ctrl) || identity.isPair(ctrl)) {
        replaceNode(key, path11, ctrl);
        return visit_(key, ctrl, visitor, path11);
      }
      if (typeof ctrl !== "symbol") {
        if (identity.isCollection(node)) {
          path11 = Object.freeze(path11.concat(node));
          for (let i = 0; i < node.items.length; ++i) {
            const ci = visit_(i, node.items[i], visitor, path11);
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
          path11 = Object.freeze(path11.concat(node));
          const ck = visit_("key", node.key, visitor, path11);
          if (ck === BREAK)
            return BREAK;
          else if (ck === REMOVE)
            node.key = null;
          const cv = visit_("value", node.value, visitor, path11);
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
    async function visitAsync_(key, node, visitor, path11) {
      const ctrl = await callVisitor(key, node, visitor, path11);
      if (identity.isNode(ctrl) || identity.isPair(ctrl)) {
        replaceNode(key, path11, ctrl);
        return visitAsync_(key, ctrl, visitor, path11);
      }
      if (typeof ctrl !== "symbol") {
        if (identity.isCollection(node)) {
          path11 = Object.freeze(path11.concat(node));
          for (let i = 0; i < node.items.length; ++i) {
            const ci = await visitAsync_(i, node.items[i], visitor, path11);
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
          path11 = Object.freeze(path11.concat(node));
          const ck = await visitAsync_("key", node.key, visitor, path11);
          if (ck === BREAK)
            return BREAK;
          else if (ck === REMOVE)
            node.key = null;
          const cv = await visitAsync_("value", node.value, visitor, path11);
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
    function callVisitor(key, node, visitor, path11) {
      if (typeof visitor === "function")
        return visitor(key, node, path11);
      if (identity.isMap(node))
        return visitor.Map?.(key, node, path11);
      if (identity.isSeq(node))
        return visitor.Seq?.(key, node, path11);
      if (identity.isPair(node))
        return visitor.Pair?.(key, node, path11);
      if (identity.isScalar(node))
        return visitor.Scalar?.(key, node, path11);
      if (identity.isAlias(node))
        return visitor.Alias?.(key, node, path11);
      return void 0;
    }
    function replaceNode(key, path11, node) {
      const parent = path11[path11.length - 1];
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
        const pt2 = identity.isAlias(parent) ? "alias" : "scalar";
        throw new Error(`Cannot replace node with ${pt2} parent`);
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
      add(line3, onError) {
        if (this.atNextDocument) {
          this.yaml = { explicit: _Directives.defaultYaml.explicit, version: "1.1" };
          this.tags = Object.assign({}, _Directives.defaultTags);
          this.atNextDocument = false;
        }
        const parts = line3.trim().split(/[ \t]+/);
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
        const lines2 = this.yaml.explicit ? [`%YAML ${this.yaml.version || "1.2"}`] : [];
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
            lines2.push(`%TAG ${handle} ${prefix}`);
        }
        return lines2.join("\n");
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
          for (const k2 of Array.from(val.keys())) {
            const v0 = val.get(k2);
            const v1 = applyReviver(reviver, val, k2, v0);
            if (v1 === void 0)
              val.delete(k2);
            else if (v1 !== v0)
              val.set(k2, v1);
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
          for (const [k2, v0] of Object.entries(val)) {
            const v1 = applyReviver(reviver, val, k2, v0);
            if (v1 === void 0)
              delete val[k2];
            else if (v1 !== v0)
              val[k2] = v1;
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
          for (const { count, res: res2 } of ctx.anchors.values())
            onAnchor(res2, count);
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
        let count = 0;
        for (const item of node.items) {
          const c = getAliasCount(doc, item, anchors2);
          if (c > count)
            count = c;
        }
        return count;
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
    function collectionFromPath(schema, path11, value) {
      let v = value;
      for (let i = path11.length - 1; i >= 0; --i) {
        const k2 = path11[i];
        if (typeof k2 === "number" && Number.isInteger(k2) && k2 >= 0) {
          const a = [];
          a[k2] = v;
          v = a;
        } else {
          v = /* @__PURE__ */ new Map([[k2, v]]);
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
    var isEmptyPath = (path11) => path11 == null || typeof path11 === "object" && !!path11[Symbol.iterator]().next().done;
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
        copy.items = copy.items.map((it2) => identity.isNode(it2) || identity.isPair(it2) ? it2.clone(schema) : it2);
        if (this.range)
          copy.range = this.range.slice();
        return copy;
      }
      /**
       * Adds a value to the collection. For `!!map` and `!!omap` the value must
       * be a Pair instance or a `{ key, value }` object, which may not have a key
       * that already exists in the map.
       */
      addIn(path11, value) {
        if (isEmptyPath(path11))
          this.add(value);
        else {
          const [key, ...rest] = path11;
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
      deleteIn(path11) {
        const [key, ...rest] = path11;
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
      getIn(path11, keepScalar) {
        const [key, ...rest] = path11;
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
      hasIn(path11) {
        const [key, ...rest] = path11;
        if (rest.length === 0)
          return this.has(key);
        const node = this.get(key, true);
        return identity.isCollection(node) ? node.hasIn(rest) : false;
      }
      /**
       * Sets a value in this collection. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      setIn(path11, value) {
        const [key, ...rest] = path11;
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
    var stringifyComment = (str4) => str4.replace(/^(?!$)(?: $)?/gm, "#");
    function indentComment(comment, indent) {
      if (/^\n+$/.test(comment))
        return comment.substring(1);
      return indent ? comment.replace(/^(?! *$)/gm, indent) : comment;
    }
    var lineComment = (str4, indent, comment) => str4.endsWith("\n") ? indentComment(comment, indent) : comment.includes("\n") ? "\n" + indentComment(comment, indent) : (str4.endsWith(" ") ? "" : " ") + comment;
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
              const j2 = i > escEnd + 1 ? i - 2 : escStart - 1;
              if (escapedFolds[j2])
                return text;
              folds.push(j2);
              escapedFolds[j2] = true;
              end = j2 + endStep;
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
    var containsDocumentMarker = (str4) => /^(%|---|\.\.\.)/m.test(str4);
    function lineLengthOverLimit(str4, lineWidth, indentLength) {
      if (!lineWidth || lineWidth < 0)
        return false;
      const limit = lineWidth - indentLength;
      const strLen = str4.length;
      if (strLen <= limit)
        return false;
      for (let i = 0, start = 0; i < strLen; ++i) {
        if (str4[i] === "\n") {
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
      let str4 = "";
      let start = 0;
      for (let i = 0, ch = json[i]; ch; ch = json[++i]) {
        if (ch === " " && json[i + 1] === "\\" && json[i + 2] === "n") {
          str4 += json.slice(start, i) + "\\ ";
          i += 1;
          start = i;
          ch = "\\";
        }
        if (ch === "\\")
          switch (json[i + 1]) {
            case "u":
              {
                str4 += json.slice(start, i);
                const code = json.substr(i + 2, 4);
                switch (code) {
                  case "0000":
                    str4 += "\\0";
                    break;
                  case "0007":
                    str4 += "\\a";
                    break;
                  case "000b":
                    str4 += "\\v";
                    break;
                  case "001b":
                    str4 += "\\e";
                    break;
                  case "0085":
                    str4 += "\\N";
                    break;
                  case "00a0":
                    str4 += "\\_";
                    break;
                  case "2028":
                    str4 += "\\L";
                    break;
                  case "2029":
                    str4 += "\\P";
                    break;
                  default:
                    if (code.substr(0, 2) === "00")
                      str4 += "\\x" + code.substr(2);
                    else
                      str4 += json.substr(i, 6);
                }
                i += 5;
                start = i + 1;
              }
              break;
            case "n":
              if (implicitKey || json[i + 2] === '"' || json.length < minMultiLineLength) {
                i += 1;
              } else {
                str4 += json.slice(start, i) + "\n\n";
                while (json[i + 2] === "\\" && json[i + 3] === "n" && json[i + 4] !== '"') {
                  str4 += "\n";
                  i += 2;
                }
                str4 += indent;
                if (json[i + 2] === " ")
                  str4 += "\\";
                i += 1;
                start = i + 1;
              }
              break;
            default:
              i += 1;
          }
      }
      str4 = start ? str4 + json.slice(start) : json;
      return implicitKey ? str4 : foldFlowLines.foldFlowLines(str4, indent, foldFlowLines.FOLD_QUOTED, getFoldOptions(ctx, false));
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
      const str4 = value.replace(/\n+/g, `$&
${indent}`);
      if (actualString) {
        const test = (tag) => tag.default && tag.tag !== "tag:yaml.org,2002:str" && tag.test?.test(str4);
        const { compat, tags } = ctx.doc.schema;
        if (tags.some(test) || compat?.some(test))
          return quotedString(value, ctx);
      }
      return implicitKey ? str4 : foldFlowLines.foldFlowLines(str4, indent, foldFlowLines.FOLD_FLOW, getFoldOptions(ctx, false));
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
      const str4 = typeof tagObj.stringify === "function" ? tagObj.stringify(node, ctx, onComment, onChompKeep) : identity.isScalar(node) ? stringifyString.stringifyString(node, ctx, onComment, onChompKeep) : node.toString(ctx, onComment, onChompKeep);
      if (!props)
        return str4;
      return identity.isScalar(node) || str4[0] === "{" || str4[0] === "[" ? `${props} ${str4}` : `${props}
${ctx.indent}${str4}`;
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
      let str4 = stringify2.stringify(key, ctx, () => keyCommentDone = true, () => chompKeep = true);
      if (!explicitKey && !ctx.inFlow && str4.length > 1024) {
        if (simpleKeys)
          throw new Error("With simple keys, single line scalar must not span more than 1024 characters");
        explicitKey = true;
      }
      if (ctx.inFlow) {
        if (allNullValues || value == null) {
          if (keyCommentDone && onComment)
            onComment();
          return str4 === "" ? "?" : explicitKey ? `? ${str4}` : str4;
        }
      } else if (allNullValues && !simpleKeys || value == null && explicitKey) {
        str4 = `? ${str4}`;
        if (keyComment && !keyCommentDone) {
          str4 += stringifyComment.lineComment(str4, ctx.indent, commentString(keyComment));
        } else if (chompKeep && onChompKeep)
          onChompKeep();
        return str4;
      }
      if (keyCommentDone)
        keyComment = null;
      if (explicitKey) {
        if (keyComment)
          str4 += stringifyComment.lineComment(str4, ctx.indent, commentString(keyComment));
        str4 = `? ${str4}
${indent}:`;
      } else {
        str4 = `${str4}:`;
        if (keyComment)
          str4 += stringifyComment.lineComment(str4, ctx.indent, commentString(keyComment));
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
        ctx.indentAtStart = str4.length + 1;
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
      str4 += ws + valueStr;
      if (ctx.inFlow) {
        if (valueCommentDone && onComment)
          onComment();
      } else if (valueComment && !valueCommentDone) {
        str4 += stringifyComment.lineComment(str4, ctx.indent, commentString(valueComment));
      } else if (chompKeep && onChompKeep) {
        onChompKeep();
      }
      return str4;
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
        for (const it2 of source.items)
          mergeValue(ctx, map, it2);
      else if (Array.isArray(source))
        for (const it2 of source)
          mergeValue(ctx, map, it2);
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
      const k2 = createNode.createNode(key, void 0, ctx);
      const v = createNode.createNode(value, void 0, ctx);
      return new Pair(k2, v);
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
      toJSON(_2, ctx) {
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
      const lines2 = [];
      for (let i = 0; i < items.length; ++i) {
        const item = items[i];
        let comment2 = null;
        if (identity.isNode(item)) {
          if (!chompKeep && item.spaceBefore)
            lines2.push("");
          addCommentBefore(ctx, lines2, item.commentBefore, chompKeep);
          if (item.comment)
            comment2 = item.comment;
        } else if (identity.isPair(item)) {
          const ik = identity.isNode(item.key) ? item.key : null;
          if (ik) {
            if (!chompKeep && ik.spaceBefore)
              lines2.push("");
            addCommentBefore(ctx, lines2, ik.commentBefore, chompKeep);
          }
        }
        chompKeep = false;
        let str5 = stringify2.stringify(item, itemCtx, () => comment2 = null, () => chompKeep = true);
        if (comment2)
          str5 += stringifyComment.lineComment(str5, itemIndent, commentString(comment2));
        if (chompKeep && comment2)
          chompKeep = false;
        lines2.push(blockItemPrefix + str5);
      }
      let str4;
      if (lines2.length === 0) {
        str4 = flowChars.start + flowChars.end;
      } else {
        str4 = lines2[0];
        for (let i = 1; i < lines2.length; ++i) {
          const line3 = lines2[i];
          str4 += line3 ? `
${indent}${line3}` : "\n";
        }
      }
      if (comment) {
        str4 += "\n" + stringifyComment.indentComment(commentString(comment), indent);
        if (onComment)
          onComment();
      } else if (chompKeep && onChompKeep)
        onChompKeep();
      return str4;
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
      const lines2 = [];
      for (let i = 0; i < items.length; ++i) {
        const item = items[i];
        let comment = null;
        if (identity.isNode(item)) {
          if (item.spaceBefore)
            lines2.push("");
          addCommentBefore(ctx, lines2, item.commentBefore, false);
          if (item.comment)
            comment = item.comment;
        } else if (identity.isPair(item)) {
          const ik = identity.isNode(item.key) ? item.key : null;
          if (ik) {
            if (ik.spaceBefore)
              lines2.push("");
            addCommentBefore(ctx, lines2, ik.commentBefore, false);
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
        let str4 = stringify2.stringify(item, itemCtx, () => comment = null);
        reqNewline || (reqNewline = lines2.length > linesAtValue || str4.includes("\n"));
        if (i < items.length - 1) {
          str4 += ",";
        } else if (ctx.options.trailingComma) {
          if (ctx.options.lineWidth > 0) {
            reqNewline || (reqNewline = lines2.reduce((sum, line3) => sum + line3.length + 2, 2) + (str4.length + 2) > ctx.options.lineWidth);
          }
          if (reqNewline) {
            str4 += ",";
          }
        }
        if (comment)
          str4 += stringifyComment.lineComment(str4, itemIndent, commentString(comment));
        lines2.push(str4);
        linesAtValue = lines2.length;
      }
      const { start, end } = flowChars;
      if (lines2.length === 0) {
        return start + end;
      } else {
        if (!reqNewline) {
          const len = lines2.reduce((sum, line3) => sum + line3.length + 2, 2);
          reqNewline = ctx.options.lineWidth > 0 && len > ctx.options.lineWidth;
        }
        if (reqNewline) {
          let str4 = start;
          for (const line3 of lines2)
            str4 += line3 ? `
${indentStep}${indent}${line3}` : "\n";
          return `${str4}
${indent}${end}`;
        } else {
          return `${start}${fcPadding}${lines2.join(" ")}${fcPadding}${end}`;
        }
      }
    }
    function addCommentBefore({ indent, options: { commentString } }, lines2, comment, chompKeep) {
      if (comment && chompKeep)
        comment = comment.replace(/^\n+/, "");
      if (comment) {
        const ic = stringifyComment.indentComment(commentString(comment), indent);
        lines2.push(ic.trimStart());
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
      const k2 = identity.isScalar(key) ? key.value : key;
      for (const it2 of items) {
        if (identity.isPair(it2)) {
          if (it2.key === key || it2.key === k2)
            return it2;
          if (identity.isScalar(it2.key) && it2.key.value === k2)
            return it2;
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
        const it2 = findPair(this.items, key);
        if (!it2)
          return false;
        const del = this.items.splice(this.items.indexOf(it2), 1);
        return del.length > 0;
      }
      get(key, keepScalar) {
        const it2 = findPair(this.items, key);
        const node = it2?.value;
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
      toJSON(_2, ctx, Type) {
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
        const it2 = this.items[idx];
        return !keepScalar && identity.isScalar(it2) ? it2.value : it2;
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
      toJSON(_2, ctx) {
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
          for (let it2 of obj) {
            if (typeof replacer === "function") {
              const key = obj instanceof Set ? it2 : String(i++);
              it2 = replacer.call(obj, key, it2);
            }
            seq.items.push(createNode.createNode(it2, void 0, ctx));
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
      resolve: (str4) => str4,
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
      resolve: (str4) => new Scalar.Scalar(str4[0] === "t" || str4[0] === "T"),
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
      const num = typeof value === "number" ? value : Number(value);
      if (!isFinite(num))
        return isNaN(num) ? ".nan" : num < 0 ? "-.inf" : ".inf";
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
      resolve: (str4) => str4.slice(-3).toLowerCase() === "nan" ? NaN : str4[0] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
      stringify: stringifyNumber.stringifyNumber
    };
    var floatExp = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      format: "EXP",
      test: /^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)[eE][-+]?[0-9]+$/,
      resolve: (str4) => parseFloat(str4),
      stringify(node) {
        const num = Number(node.value);
        return isFinite(num) ? num.toExponential() : stringifyNumber.stringifyNumber(node);
      }
    };
    var float = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^[-+]?(?:\.[0-9]+|[0-9]+\.[0-9]*)$/,
      resolve(str4) {
        const node = new Scalar.Scalar(parseFloat(str4));
        const dot = str4.indexOf(".");
        if (dot !== -1 && str4[str4.length - 1] === "0")
          node.minFractionDigits = str4.length - dot - 1;
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
    var intResolve = (str4, offset, radix, { intAsBigInt }) => intAsBigInt ? BigInt(str4) : parseInt(str4.substring(offset), radix);
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
      resolve: (str4, _onError, opt) => intResolve(str4, 2, 8, opt),
      stringify: (node) => intStringify(node, 8, "0o")
    };
    var int3 = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      test: /^[-+]?[0-9]+$/,
      resolve: (str4, _onError, opt) => intResolve(str4, 0, 10, opt),
      stringify: stringifyNumber.stringifyNumber
    };
    var intHex = {
      identify: (value) => intIdentify(value) && value >= 0,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "HEX",
      test: /^0x[0-9a-fA-F]+$/,
      resolve: (str4, _onError, opt) => intResolve(str4, 2, 16, opt),
      stringify: (node) => intStringify(node, 16, "0x")
    };
    exports2.int = int3;
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
    var int3 = require_int();
    var schema = [
      map.map,
      seq.seq,
      string.string,
      _null.nullTag,
      bool.boolTag,
      int3.intOct,
      int3.int,
      int3.intHex,
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
        resolve: (str4) => str4,
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
        resolve: (str4) => str4 === "true",
        stringify: stringifyJSON
      },
      {
        identify: intIdentify,
        default: true,
        tag: "tag:yaml.org,2002:int",
        test: /^-?(?:0|[1-9][0-9]*)$/,
        resolve: (str4, _onError, { intAsBigInt }) => intAsBigInt ? BigInt(str4) : parseInt(str4, 10),
        stringify: ({ value }) => intIdentify(value) ? value.toString() : JSON.stringify(value)
      },
      {
        identify: (value) => typeof value === "number",
        default: true,
        tag: "tag:yaml.org,2002:float",
        test: /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*)?(?:[eE][-+]?[0-9]+)?$/,
        resolve: (str4) => parseFloat(str4),
        stringify: stringifyJSON
      }
    ];
    var jsonError = {
      default: true,
      tag: "",
      test: /^/,
      resolve(str4, onError) {
        onError(`Unresolved plain scalar ${JSON.stringify(str4)}`);
        return str4;
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
          const str4 = atob(src.replace(/[\n\r]/g, ""));
          const buffer = new Uint8Array(str4.length);
          for (let i = 0; i < str4.length; ++i)
            buffer[i] = str4.charCodeAt(i);
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
        let str4;
        if (typeof node_buffer.Buffer === "function") {
          str4 = buf instanceof node_buffer.Buffer ? buf.toString("base64") : node_buffer.Buffer.from(buf.buffer).toString("base64");
        } else if (typeof btoa === "function") {
          let s = "";
          for (let i = 0; i < buf.length; ++i)
            s += String.fromCharCode(buf[i]);
          str4 = btoa(s);
        } else {
          throw new Error("This environment does not support writing binary tags; either Buffer or btoa is required");
        }
        type ?? (type = Scalar.Scalar.BLOCK_LITERAL);
        if (type !== Scalar.Scalar.QUOTE_DOUBLE) {
          const lineWidth = Math.max(ctx.options.lineWidth - ctx.indent.length, ctx.options.minContentWidth);
          const n = Math.ceil(str4.length / lineWidth);
          const lines2 = new Array(n);
          for (let i = 0, o = 0; i < n; ++i, o += lineWidth) {
            lines2[i] = str4.substr(o, lineWidth);
          }
          str4 = lines2.join(type === Scalar.Scalar.BLOCK_LITERAL ? "\n" : " ");
        }
        return stringifyString.stringifyString({ comment, type, value: str4 }, ctx, onComment, onChompKeep);
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
        for (let it2 of iterable) {
          if (typeof replacer === "function")
            it2 = replacer.call(iterable, String(i++), it2);
          let key, value;
          if (Array.isArray(it2)) {
            if (it2.length === 2) {
              key = it2[0];
              value = it2[1];
            } else
              throw new TypeError(`Expected [key, value] tuple: ${it2}`);
          } else if (it2 && it2 instanceof Object) {
            const keys = Object.keys(it2);
            if (keys.length === 1) {
              key = keys[0];
              value = it2[key];
            } else {
              throw new TypeError(`Expected tuple with one key, not ${keys.length} keys`);
            }
          } else {
            key = it2;
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
      toJSON(_2, ctx) {
        if (!ctx)
          return super.toJSON(_2);
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
      resolve: (str4) => str4.slice(-3).toLowerCase() === "nan" ? NaN : str4[0] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
      stringify: stringifyNumber.stringifyNumber
    };
    var floatExp = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      format: "EXP",
      test: /^[-+]?(?:[0-9][0-9_]*)?(?:\.[0-9_]*)?[eE][-+]?[0-9]+$/,
      resolve: (str4) => parseFloat(str4.replace(/_/g, "")),
      stringify(node) {
        const num = Number(node.value);
        return isFinite(num) ? num.toExponential() : stringifyNumber.stringifyNumber(node);
      }
    };
    var float = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^[-+]?(?:[0-9][0-9_]*)?\.[0-9_]*$/,
      resolve(str4) {
        const node = new Scalar.Scalar(parseFloat(str4.replace(/_/g, "")));
        const dot = str4.indexOf(".");
        if (dot !== -1) {
          const f = str4.substring(dot + 1).replace(/_/g, "");
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
    function intResolve(str4, offset, radix, { intAsBigInt }) {
      const sign = str4[0];
      if (sign === "-" || sign === "+")
        offset += 1;
      str4 = str4.substring(offset).replace(/_/g, "");
      if (intAsBigInt) {
        switch (radix) {
          case 2:
            str4 = `0b${str4}`;
            break;
          case 8:
            str4 = `0o${str4}`;
            break;
          case 16:
            str4 = `0x${str4}`;
            break;
        }
        const n2 = BigInt(str4);
        return sign === "-" ? BigInt(-1) * n2 : n2;
      }
      const n = parseInt(str4, radix);
      return sign === "-" ? -1 * n : n;
    }
    function intStringify(node, radix, prefix) {
      const { value } = node;
      if (intIdentify(value)) {
        const str4 = value.toString(radix);
        return value < 0 ? "-" + prefix + str4.substr(1) : prefix + str4;
      }
      return stringifyNumber.stringifyNumber(node);
    }
    var intBin = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "BIN",
      test: /^[-+]?0b[0-1_]+$/,
      resolve: (str4, _onError, opt) => intResolve(str4, 2, 2, opt),
      stringify: (node) => intStringify(node, 2, "0b")
    };
    var intOct = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "OCT",
      test: /^[-+]?0[0-7_]+$/,
      resolve: (str4, _onError, opt) => intResolve(str4, 1, 8, opt),
      stringify: (node) => intStringify(node, 8, "0")
    };
    var int3 = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      test: /^[-+]?[0-9][0-9_]*$/,
      resolve: (str4, _onError, opt) => intResolve(str4, 0, 10, opt),
      stringify: stringifyNumber.stringifyNumber
    };
    var intHex = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "HEX",
      test: /^[-+]?0x[0-9a-fA-F_]+$/,
      resolve: (str4, _onError, opt) => intResolve(str4, 2, 16, opt),
      stringify: (node) => intStringify(node, 16, "0x")
    };
    exports2.int = int3;
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
      toJSON(_2, ctx) {
        return super.toJSON(_2, ctx, Set);
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
    function parseSexagesimal(str4, asBigInt) {
      const sign = str4[0];
      const parts = sign === "-" || sign === "+" ? str4.substring(1) : str4;
      const num = (n) => asBigInt ? BigInt(n) : Number(n);
      const res = parts.replace(/_/g, "").split(":").reduce((res2, p) => res2 * num(60) + num(p), num(0));
      return sign === "-" ? num(-1) * res : res;
    }
    function stringifySexagesimal(node) {
      let { value } = node;
      let num = (n) => n;
      if (typeof value === "bigint")
        num = (n) => BigInt(n);
      else if (isNaN(value) || !isFinite(value))
        return stringifyNumber.stringifyNumber(node);
      let sign = "";
      if (value < 0) {
        sign = "-";
        value *= num(-1);
      }
      const _60 = num(60);
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
      resolve: (str4, _onError, { intAsBigInt }) => parseSexagesimal(str4, intAsBigInt),
      stringify: stringifySexagesimal
    };
    var floatTime = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      format: "TIME",
      test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*$/,
      resolve: (str4) => parseSexagesimal(str4, false),
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
      resolve(str4) {
        const match = str4.match(timestamp.test);
        if (!match)
          throw new Error("!!timestamp expects a date, starting with yyyy-mm-dd");
        const [, year, month, day, hour, minute, second] = match.map(Number);
        const millisec = match[7] ? Number((match[7] + "00").substr(1, 3)) : 0;
        let date2 = Date.UTC(year, month - 1, day, hour || 0, minute || 0, second || 0, millisec);
        const tz = match[8];
        if (tz && tz !== "Z") {
          let d = parseSexagesimal(tz, false);
          if (Math.abs(d) < 30)
            d *= 60;
          date2 -= 6e4 * d;
        }
        return new Date(date2);
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
    var int3 = require_int2();
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
      int3.intBin,
      int3.intOct,
      int3.int,
      int3.intHex,
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
    var int3 = require_int();
    var schema = require_schema();
    var schema$1 = require_schema2();
    var binary = require_binary();
    var merge = require_merge();
    var omap = require_omap();
    var pairs = require_pairs();
    var schema$2 = require_schema3();
    var set = require_set();
    var timestamp = require_timestamp();
    var schemas5 = /* @__PURE__ */ new Map([
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
      int: int3.int,
      intHex: int3.intHex,
      intOct: int3.intOct,
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
      const schemaTags = schemas5.get(schemaName);
      if (schemaTags && !customTags) {
        return addMergeTag && !schemaTags.includes(merge.merge) ? schemaTags.concat(merge.merge) : schemaTags.slice();
      }
      let tags = schemaTags;
      if (!tags) {
        if (Array.isArray(customTags))
          tags = [];
        else {
          const keys = Array.from(schemas5.keys()).filter((key) => key !== "yaml11").map((key) => JSON.stringify(key)).join(", ");
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
    var Schema = class _Schema {
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
    exports2.Schema = Schema;
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
      const lines2 = [];
      let hasDirectives = options.directives === true;
      if (options.directives !== false && doc.directives) {
        const dir = doc.directives.toString(doc);
        if (dir) {
          lines2.push(dir);
          hasDirectives = true;
        } else if (doc.directives.docStart)
          hasDirectives = true;
      }
      if (hasDirectives)
        lines2.push("---");
      const ctx = stringify2.createStringifyContext(doc, options);
      const { commentString } = ctx.options;
      if (doc.commentBefore) {
        if (lines2.length !== 1)
          lines2.unshift("");
        const cs = commentString(doc.commentBefore);
        lines2.unshift(stringifyComment.indentComment(cs, ""));
      }
      let chompKeep = false;
      let contentComment = null;
      if (doc.contents) {
        if (identity.isNode(doc.contents)) {
          if (doc.contents.spaceBefore && hasDirectives)
            lines2.push("");
          if (doc.contents.commentBefore) {
            const cs = commentString(doc.contents.commentBefore);
            lines2.push(stringifyComment.indentComment(cs, ""));
          }
          ctx.forceBlockIndent = !!doc.comment;
          contentComment = doc.contents.comment;
        }
        const onChompKeep = contentComment ? void 0 : () => chompKeep = true;
        let body = stringify2.stringify(doc.contents, ctx, () => contentComment = null, onChompKeep);
        if (contentComment)
          body += stringifyComment.lineComment(body, "", commentString(contentComment));
        if ((body[0] === "|" || body[0] === ">") && lines2[lines2.length - 1] === "---") {
          lines2[lines2.length - 1] = `--- ${body}`;
        } else
          lines2.push(body);
      } else {
        lines2.push(stringify2.stringify(doc.contents, ctx));
      }
      if (doc.directives?.docEnd) {
        if (doc.comment) {
          const cs = commentString(doc.comment);
          if (cs.includes("\n")) {
            lines2.push("...");
            lines2.push(stringifyComment.indentComment(cs, ""));
          } else {
            lines2.push(`... ${cs}`);
          }
        } else {
          lines2.push("...");
        }
      } else {
        let dc = doc.comment;
        if (dc && chompKeep)
          dc = dc.replace(/^\n+/, "");
        if (dc) {
          if ((!chompKeep || contentComment) && lines2[lines2.length - 1] !== "")
            lines2.push("");
          lines2.push(stringifyComment.indentComment(commentString(dc), ""));
        }
      }
      return lines2.join("\n") + "\n";
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
    var Schema = require_Schema();
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
      addIn(path11, value) {
        if (assertCollection(this.contents))
          this.contents.addIn(path11, value);
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
        const k2 = this.createNode(key, null, options);
        const v = this.createNode(value, null, options);
        return new Pair.Pair(k2, v);
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
      deleteIn(path11) {
        if (Collection.isEmptyPath(path11)) {
          if (this.contents == null)
            return false;
          this.contents = null;
          return true;
        }
        return assertCollection(this.contents) ? this.contents.deleteIn(path11) : false;
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
      getIn(path11, keepScalar) {
        if (Collection.isEmptyPath(path11))
          return !keepScalar && identity.isScalar(this.contents) ? this.contents.value : this.contents;
        return identity.isCollection(this.contents) ? this.contents.getIn(path11, keepScalar) : void 0;
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
      hasIn(path11) {
        if (Collection.isEmptyPath(path11))
          return this.contents !== void 0;
        return identity.isCollection(this.contents) ? this.contents.hasIn(path11) : false;
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
      setIn(path11, value) {
        if (Collection.isEmptyPath(path11)) {
          this.contents = value;
        } else if (this.contents == null) {
          this.contents = Collection.collectionFromPath(this.schema, Array.from(path11), value);
        } else if (assertCollection(this.contents)) {
          this.contents.setIn(path11, value);
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
          this.schema = new Schema.Schema(Object.assign(opt, options));
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
          for (const { count, res: res2 } of ctx.anchors.values())
            onAnchor(res2, count);
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
          const s = JSON.stringify(options.indent);
          throw new Error(`"indent" option must be a positive integer, not ${s}`);
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
      const { line: line3, col } = error.linePos[0];
      error.message += ` at line ${line3}, column ${col}`;
      let ci = col - 1;
      let lineStr = src.substring(lc.lineStarts[line3 - 1], lc.lineStarts[line3]).replace(/[\n\r]+$/, "");
      if (ci >= 60 && lineStr.length > 80) {
        const trimStart = Math.min(ci - 39, lineStr.length - 79);
        lineStr = "\u2026" + lineStr.substring(trimStart);
        ci -= trimStart - 1;
      }
      if (lineStr.length > 80)
        lineStr = lineStr.substring(0, 79) + "\u2026";
      if (line3 > 1 && /^ *$/.test(lineStr.substring(0, ci))) {
        let prev = src.substring(lc.lineStarts[line3 - 2], lc.lineStarts[line3 - 1]);
        if (prev.length > 80)
          prev = prev.substring(0, 79) + "\u2026\n";
        lineStr = prev + lineStr;
      }
      if (/[^ ]/.test(lineStr)) {
        let count = 1;
        const end = error.linePos[1];
        if (end?.line === line3 && end.col > col) {
          count = Math.max(1, Math.min(end.col - col, 80 - ci));
        }
        const pointer = " ".repeat(ci) + "^".repeat(count);
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
            for (const st2 of key.end)
              if (st2.type === "newline")
                return true;
          }
          return false;
        case "flow-collection":
          for (const it2 of key.items) {
            for (const st2 of it2.start)
              if (st2.type === "newline")
                return true;
            if (it2.sep) {
              for (const st2 of it2.sep)
                if (st2.type === "newline")
                  return true;
            }
            if (containsNewline(it2.key) || containsNewline(it2.value))
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
            loop: for (const st2 of start) {
              switch (st2.type) {
                case "comma":
                case "space":
                  break;
                case "comment":
                  prevItemComment = st2.source.substring(1);
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
                for (const st2 of sep) {
                  if (st2 === valueProps.found)
                    break;
                  if (st2.type === "newline") {
                    onError(st2, "MULTILINE_IMPLICIT_KEY", "Implicit keys of flow sequence pairs need to be on a single line");
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
      const [ce2, ...ee2] = fc.end;
      let cePos = offset;
      if (ce2?.source === expectedEnd)
        cePos = ce2.offset + ce2.source.length;
      else {
        const name = fcName[0].toUpperCase() + fcName.substring(1);
        const msg = atRoot ? `${name} must end with a ${expectedEnd}` : `${name} in block collection must be sufficiently indented and end with a ${expectedEnd}`;
        onError(offset, atRoot ? "MISSING_CHAR" : "BAD_INDENT", msg);
        if (ce2 && ce2.source.length !== 1)
          ee2.unshift(ce2);
      }
      if (ee2.length > 0) {
        const end = resolveEnd.resolveEnd(ee2, cePos, ctx.options.strict, onError);
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
        const kt2 = ctx.schema.knownTags[tagName];
        if (kt2?.collection === expType) {
          ctx.schema.tags.push(Object.assign({}, kt2, { default: false }));
          tag = kt2;
        } else {
          if (kt2) {
            onError(tagToken, "BAD_COLLECTION_TYPE", `${kt2.tag} used for ${expType} collection, but expects ${kt2.collection ?? "scalar"}`, true);
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
      const lines2 = scalar.source ? splitLines(scalar.source) : [];
      let chompStart = lines2.length;
      for (let i = lines2.length - 1; i >= 0; --i) {
        const content = lines2[i][1];
        if (content === "" || content === "\r")
          chompStart = i;
        else
          break;
      }
      if (chompStart === 0) {
        const value2 = header.chomp === "+" && lines2.length > 0 ? "\n".repeat(Math.max(1, lines2.length - 1)) : "";
        let end2 = start + header.length;
        if (scalar.source)
          end2 += scalar.source.length;
        return { value: value2, type, comment: header.comment, range: [start, end2, end2] };
      }
      let trimIndent = scalar.indent + header.indent;
      let offset = scalar.offset + header.length;
      let contentStart = 0;
      for (let i = 0; i < chompStart; ++i) {
        const [indent, content] = lines2[i];
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
      for (let i = lines2.length - 1; i >= chompStart; --i) {
        if (lines2[i][0].length > trimIndent)
          chompStart = i + 1;
      }
      let value = "";
      let sep = "";
      let prevMoreIndented = false;
      for (let i = 0; i < contentStart; ++i)
        value += lines2[i][0].slice(trimIndent) + "\n";
      for (let i = contentStart; i < chompStart; ++i) {
        let [indent, content] = lines2[i];
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
          for (let i = chompStart; i < lines2.length; ++i)
            value += "\n" + lines2[i][0].slice(trimIndent);
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
      const lines2 = [line0];
      for (let i = 1; i < split.length; i += 2)
        lines2.push([split[i], split[i + 1]]);
      return lines2;
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
      const re2 = resolveEnd.resolveEnd(end, valueEnd, strict, onError);
      return {
        value,
        type: _type,
        comment: re2.comment,
        range: [offset, valueEnd, re2.offset]
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
      const line3 = /(.*?)\r?\n/sy;
      let match = line3.exec(source);
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
      let pos = line3.lastIndex;
      while (match = line3.exec(source)) {
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
        pos = line3.lastIndex;
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
      const kt2 = schema.knownTags[tagName];
      if (kt2 && !kt2.collection) {
        schema.tags.push(Object.assign({}, kt2, { default: false, test: void 0 }));
        return kt2;
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
          let st2 = before[i];
          switch (st2.type) {
            case "space":
            case "comment":
            case "newline":
              offset -= st2.source.length;
              continue;
          }
          st2 = before[++i];
          while (st2?.type === "space") {
            offset += st2.source.length;
            st2 = before[++i];
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
      const re2 = resolveEnd.resolveEnd(end, valueEnd, options.strict, onError);
      alias.range = [offset, valueEnd, re2.offset];
      if (re2.comment)
        alias.comment = re2.comment;
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
      const re2 = resolveEnd.resolveEnd(end, contentEnd, false, onError);
      if (re2.comment)
        doc.comment = re2.comment;
      doc.range = [offset, contentEnd, re2.offset];
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
            let it2 = dc.items[0];
            if (identity.isPair(it2))
              it2 = it2.key;
            const cb = it2.commentBefore;
            it2.commentBefore = cb ? `${comment}
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
          const he2 = source.indexOf("\n");
          const head = source.substring(0, he2);
          const body = source.substring(he2 + 1) + "\n";
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
      const he2 = source.indexOf("\n");
      const head = source.substring(0, he2);
      const body = source.substring(he2 + 1) + "\n";
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
        for (const st2 of end)
          switch (st2.type) {
            case "space":
            case "comment":
              props.push(st2);
              break;
            case "newline":
              props.push(st2);
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
          const end = "end" in token && Array.isArray(token.end) ? token.end.filter((st2) => st2.type === "space" || st2.type === "comment" || st2.type === "newline") : [];
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
          for (const st2 of token.end)
            res += st2.source;
          return res;
        }
        case "document": {
          let res = stringifyItem(token);
          if (token.end)
            for (const st2 of token.end)
              res += st2.source;
          return res;
        }
        default: {
          let res = token.source;
          if ("end" in token && token.end)
            for (const st2 of token.end)
              res += st2.source;
          return res;
        }
      }
    }
    function stringifyItem({ start, key, sep, value }) {
      let res = "";
      for (const st2 of start)
        res += st2.source;
      if (key)
        res += stringifyToken(key);
      if (sep)
        for (const st2 of sep)
          res += st2.source;
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
    var BREAK = /* @__PURE__ */ Symbol("break visit");
    var SKIP = /* @__PURE__ */ Symbol("skip children");
    var REMOVE = /* @__PURE__ */ Symbol("remove item");
    function visit(cst, visitor) {
      if ("type" in cst && cst.type === "document")
        cst = { start: cst.start, value: cst.value };
      _visit(Object.freeze([]), cst, visitor);
    }
    visit.BREAK = BREAK;
    visit.SKIP = SKIP;
    visit.REMOVE = REMOVE;
    visit.itemAtPath = (cst, path11) => {
      let item = cst;
      for (const [field2, index] of path11) {
        const tok = item?.[field2];
        if (tok && "items" in tok) {
          item = tok.items[index];
        } else
          return void 0;
      }
      return item;
    };
    visit.parentCollection = (cst, path11) => {
      const parent = visit.itemAtPath(cst, path11.slice(0, -1));
      const field2 = path11[path11.length - 1][0];
      const coll = parent?.[field2];
      if (coll && "items" in coll)
        return coll;
      throw new Error("Parent collection not found");
    };
    function _visit(path11, item, visitor) {
      let ctrl = visitor(item, path11);
      if (typeof ctrl === "symbol")
        return ctrl;
      for (const field2 of ["key", "value"]) {
        const token = item[field2];
        if (token && "items" in token) {
          for (let i = 0; i < token.items.length; ++i) {
            const ci = _visit(Object.freeze(path11.concat([[field2, i]])), token.items[i], visitor);
            if (typeof ci === "number")
              i = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              token.items.splice(i, 1);
              i -= 1;
            }
          }
          if (typeof ctrl === "function" && field2 === "key")
            ctrl = ctrl(item, path11);
        }
      }
      return typeof ctrl === "function" ? ctrl(item, path11) : ctrl;
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
    var BOM3 = "\uFEFF";
    var DOCUMENT = "";
    var FLOW_END = "";
    var SCALAR = "";
    var isCollection = (token) => !!token && "items" in token;
    var isScalar = (token) => !!token && (token.type === "scalar" || token.type === "single-quoted-scalar" || token.type === "double-quoted-scalar" || token.type === "block-scalar");
    function prettyToken(token) {
      switch (token) {
        case BOM3:
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
        case BOM3:
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
    exports2.BOM = BOM3;
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
          const dt2 = this.buffer.substr(offset, 3);
          if ((dt2 === "---" || dt2 === "...") && isEmpty(this.buffer[offset + 3]))
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
        let line3 = this.getLine();
        if (line3 === null)
          return this.setNext("stream");
        if (line3[0] === cst.BOM) {
          yield* this.pushCount(1);
          line3 = line3.substring(1);
        }
        if (line3[0] === "%") {
          let dirEnd = line3.length;
          let cs = line3.indexOf("#");
          while (cs !== -1) {
            const ch = line3[cs - 1];
            if (ch === " " || ch === "	") {
              dirEnd = cs - 1;
              break;
            } else {
              cs = line3.indexOf("#", cs + 1);
            }
          }
          while (true) {
            const ch = line3[dirEnd - 1];
            if (ch === " " || ch === "	")
              dirEnd -= 1;
            else
              break;
          }
          const n = (yield* this.pushCount(dirEnd)) + (yield* this.pushSpaces(true));
          yield* this.pushCount(line3.length - n);
          this.pushNewline();
          return "stream";
        }
        if (this.atLineEnd()) {
          const sp = yield* this.pushSpaces(true);
          yield* this.pushCount(line3.length - sp);
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
          const s = this.peek(3);
          if ((s === "---" || s === "...") && isEmpty(this.charAt(3))) {
            yield* this.pushCount(3);
            this.indentValue = 0;
            this.indentNext = 0;
            return s === "---" ? "doc" : "stream";
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
        const line3 = this.getLine();
        if (line3 === null)
          return this.setNext("doc");
        let n = yield* this.pushIndicators();
        switch (line3[n]) {
          case "#":
            yield* this.pushCount(line3.length - n);
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
            yield* this.pushCount(line3.length - n);
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
        const line3 = this.getLine();
        if (line3 === null)
          return this.setNext("flow");
        if (indent !== -1 && indent < this.indentNext && line3[0] !== "#" || indent === 0 && (line3.startsWith("---") || line3.startsWith("...")) && isEmpty(line3[3])) {
          const atFlowEndMarker = indent === this.indentNext - 1 && this.flowLevel === 1 && (line3[0] === "]" || line3[0] === "}");
          if (!atFlowEndMarker) {
            this.flowLevel = 0;
            yield cst.FLOW_END;
            return yield* this.parseLineStart();
          }
        }
        let n = 0;
        while (line3[n] === ",") {
          n += yield* this.pushCount(1);
          n += yield* this.pushSpaces(true);
          this.flowKey = false;
        }
        n += yield* this.pushIndicators();
        switch (line3[n]) {
          case void 0:
            return "flow";
          case "#":
            yield* this.pushCount(line3.length - n);
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
        const quote2 = this.charAt(0);
        let end = this.buffer.indexOf(quote2, this.pos + 1);
        if (quote2 === "'") {
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
        const s = this.buffer.slice(this.pos, i);
        if (s) {
          yield s;
          this.pos += s.length;
          return s.length;
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
          const it2 = parent.items[parent.items.length - 1];
          return it2.sep ?? it2.start;
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
        for (const it2 of fc.items) {
          if (it2.sep && !it2.value && !includesToken(it2.start, "explicit-key-ind") && !includesToken(it2.sep, "map-value-ind")) {
            if (it2.key)
              it2.value = it2.key;
            delete it2.key;
            if (isFlowToken(it2.value)) {
              if (it2.value.end)
                arrayPushArray(it2.value.end, it2.sep);
              else
                it2.value.end = it2.sep;
            } else
              arrayPushArray(it2.start, it2.sep);
            delete it2.sep;
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
        const st2 = {
          type: this.type,
          offset: this.offset,
          indent: this.indent,
          source: this.source
        };
        return st2;
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
              const it2 = top.items[top.items.length - 1];
              if (it2.value) {
                top.items.push({ start: [], key: token, sep: [] });
                this.onKeyLine = true;
                return;
              } else if (it2.sep) {
                it2.value = token;
              } else {
                Object.assign(it2, { key: token, sep: [] });
                this.onKeyLine = !it2.explicitKey;
                return;
              }
              break;
            }
            case "block-seq": {
              const it2 = top.items[top.items.length - 1];
              if (it2.value)
                top.items.push({ start: [], value: token });
              else
                it2.value = token;
              break;
            }
            case "flow-collection": {
              const it2 = top.items[top.items.length - 1];
              if (!it2 || it2.value)
                top.items.push({ start: [], key: token, sep: [] });
              else if (it2.sep)
                it2.value = token;
              else
                Object.assign(it2, { key: token, sep: [] });
              return;
            }
            /* istanbul ignore next should not happen */
            default:
              yield* this.pop();
              yield* this.pop(token);
          }
          if ((top.type === "document" || top.type === "block-map" || top.type === "block-seq") && (token.type === "block-map" || token.type === "block-seq")) {
            const last = token.items[token.items.length - 1];
            if (last && !last.sep && !last.value && last.start.length > 0 && findNonEmptyIndex(last.start) === -1 && (token.indent === 0 || last.start.every((st2) => st2.type !== "comment" || st2.indent < token.indent))) {
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
        const it2 = map.items[map.items.length - 1];
        switch (this.type) {
          case "newline":
            this.onKeyLine = false;
            if (it2.value) {
              const end = "end" in it2.value ? it2.value.end : void 0;
              const last = Array.isArray(end) ? end[end.length - 1] : void 0;
              if (last?.type === "comment")
                end?.push(this.sourceToken);
              else
                map.items.push({ start: [this.sourceToken] });
            } else if (it2.sep) {
              it2.sep.push(this.sourceToken);
            } else {
              it2.start.push(this.sourceToken);
            }
            return;
          case "space":
          case "comment":
            if (it2.value) {
              map.items.push({ start: [this.sourceToken] });
            } else if (it2.sep) {
              it2.sep.push(this.sourceToken);
            } else {
              if (this.atIndentedComment(it2.start, map.indent)) {
                const prev = map.items[map.items.length - 2];
                const end = prev?.value?.end;
                if (Array.isArray(end)) {
                  arrayPushArray(end, it2.start);
                  end.push(this.sourceToken);
                  map.items.pop();
                  return;
                }
              }
              it2.start.push(this.sourceToken);
            }
            return;
        }
        if (this.indent >= map.indent) {
          const atMapIndent = !this.onKeyLine && this.indent === map.indent;
          const atNextItem = atMapIndent && (it2.sep || it2.explicitKey) && this.type !== "seq-item-ind";
          let start = [];
          if (atNextItem && it2.sep && !it2.value) {
            const nl = [];
            for (let i = 0; i < it2.sep.length; ++i) {
              const st2 = it2.sep[i];
              switch (st2.type) {
                case "newline":
                  nl.push(i);
                  break;
                case "space":
                  break;
                case "comment":
                  if (st2.indent > map.indent)
                    nl.length = 0;
                  break;
                default:
                  nl.length = 0;
              }
            }
            if (nl.length >= 2)
              start = it2.sep.splice(nl[1]);
          }
          switch (this.type) {
            case "anchor":
            case "tag":
              if (atNextItem || it2.value) {
                start.push(this.sourceToken);
                map.items.push({ start });
                this.onKeyLine = true;
              } else if (it2.sep) {
                it2.sep.push(this.sourceToken);
              } else {
                it2.start.push(this.sourceToken);
              }
              return;
            case "explicit-key-ind":
              if (!it2.sep && !it2.explicitKey) {
                it2.start.push(this.sourceToken);
                it2.explicitKey = true;
              } else if (atNextItem || it2.value) {
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
              if (it2.explicitKey) {
                if (!it2.sep) {
                  if (includesToken(it2.start, "newline")) {
                    Object.assign(it2, { key: null, sep: [this.sourceToken] });
                  } else {
                    const start2 = getFirstKeyStartProps(it2.start);
                    this.stack.push({
                      type: "block-map",
                      offset: this.offset,
                      indent: this.indent,
                      items: [{ start: start2, key: null, sep: [this.sourceToken] }]
                    });
                  }
                } else if (it2.value) {
                  map.items.push({ start: [], key: null, sep: [this.sourceToken] });
                } else if (includesToken(it2.sep, "map-value-ind")) {
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start, key: null, sep: [this.sourceToken] }]
                  });
                } else if (isFlowToken(it2.key) && !includesToken(it2.sep, "newline")) {
                  const start2 = getFirstKeyStartProps(it2.start);
                  const key = it2.key;
                  const sep = it2.sep;
                  sep.push(this.sourceToken);
                  delete it2.key;
                  delete it2.sep;
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start: start2, key, sep }]
                  });
                } else if (start.length > 0) {
                  it2.sep = it2.sep.concat(start, this.sourceToken);
                } else {
                  it2.sep.push(this.sourceToken);
                }
              } else {
                if (!it2.sep) {
                  Object.assign(it2, { key: null, sep: [this.sourceToken] });
                } else if (it2.value || atNextItem) {
                  map.items.push({ start, key: null, sep: [this.sourceToken] });
                } else if (includesToken(it2.sep, "map-value-ind")) {
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start: [], key: null, sep: [this.sourceToken] }]
                  });
                } else {
                  it2.sep.push(this.sourceToken);
                }
              }
              this.onKeyLine = true;
              return;
            case "alias":
            case "scalar":
            case "single-quoted-scalar":
            case "double-quoted-scalar": {
              const fs = this.flowScalar(this.type);
              if (atNextItem || it2.value) {
                map.items.push({ start, key: fs, sep: [] });
                this.onKeyLine = true;
              } else if (it2.sep) {
                this.stack.push(fs);
              } else {
                Object.assign(it2, { key: fs, sep: [] });
                this.onKeyLine = true;
              }
              return;
            }
            default: {
              const bv = this.startBlockValue(map);
              if (bv) {
                if (bv.type === "block-seq") {
                  if (!it2.explicitKey && it2.sep && !includesToken(it2.sep, "newline")) {
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
        const it2 = seq.items[seq.items.length - 1];
        switch (this.type) {
          case "newline":
            if (it2.value) {
              const end = "end" in it2.value ? it2.value.end : void 0;
              const last = Array.isArray(end) ? end[end.length - 1] : void 0;
              if (last?.type === "comment")
                end?.push(this.sourceToken);
              else
                seq.items.push({ start: [this.sourceToken] });
            } else
              it2.start.push(this.sourceToken);
            return;
          case "space":
          case "comment":
            if (it2.value)
              seq.items.push({ start: [this.sourceToken] });
            else {
              if (this.atIndentedComment(it2.start, seq.indent)) {
                const prev = seq.items[seq.items.length - 2];
                const end = prev?.value?.end;
                if (Array.isArray(end)) {
                  arrayPushArray(end, it2.start);
                  end.push(this.sourceToken);
                  seq.items.pop();
                  return;
                }
              }
              it2.start.push(this.sourceToken);
            }
            return;
          case "anchor":
          case "tag":
            if (it2.value || this.indent <= seq.indent)
              break;
            it2.start.push(this.sourceToken);
            return;
          case "seq-item-ind":
            if (this.indent !== seq.indent)
              break;
            if (it2.value || includesToken(it2.start, "seq-item-ind"))
              seq.items.push({ start: [this.sourceToken] });
            else
              it2.start.push(this.sourceToken);
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
        const it2 = fc.items[fc.items.length - 1];
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
              if (!it2 || it2.sep)
                fc.items.push({ start: [this.sourceToken] });
              else
                it2.start.push(this.sourceToken);
              return;
            case "map-value-ind":
              if (!it2 || it2.value)
                fc.items.push({ start: [], key: null, sep: [this.sourceToken] });
              else if (it2.sep)
                it2.sep.push(this.sourceToken);
              else
                Object.assign(it2, { key: null, sep: [this.sourceToken] });
              return;
            case "space":
            case "comment":
            case "newline":
            case "anchor":
            case "tag":
              if (!it2 || it2.value)
                fc.items.push({ start: [this.sourceToken] });
              else if (it2.sep)
                it2.sep.push(this.sourceToken);
              else
                it2.start.push(this.sourceToken);
              return;
            case "alias":
            case "scalar":
            case "single-quoted-scalar":
            case "double-quoted-scalar": {
              const fs = this.flowScalar(this.type);
              if (!it2 || it2.value)
                fc.items.push({ start: [], key: fs, sep: [] });
              else if (it2.sep)
                this.stack.push(fs);
              else
                Object.assign(it2, { key: fs, sep: [] });
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
        return start.every((st2) => st2.type === "newline" || st2.type === "space");
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
    function parseDocument(source, options = {}) {
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
    function parse4(src, reviver, options) {
      let _reviver = void 0;
      if (typeof reviver === "function") {
        _reviver = reviver;
      } else if (options === void 0 && reviver && typeof reviver === "object") {
        options = reviver;
      }
      const doc = parseDocument(src, options);
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
    exports2.parse = parse4;
    exports2.parseAllDocuments = parseAllDocuments;
    exports2.parseDocument = parseDocument;
    exports2.stringify = stringify2;
  }
});

// node_modules/yaml/dist/index.js
var require_dist = __commonJS({
  "node_modules/yaml/dist/index.js"(exports2) {
    "use strict";
    var composer = require_composer();
    var Document = require_Document();
    var Schema = require_Schema();
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
    exports2.Schema = Schema.Schema;
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

// src/cli/main.ts
var import_node_path10 = __toESM(require("node:path"), 1);
var import_node_fs9 = require("node:fs");

// src/cli/run.ts
var import_node_fs8 = require("node:fs");
var import_node_path9 = __toESM(require("node:path"), 1);

// src/lib/sync-files.ts
var phaseFile = (id) => `plan-${id.replace(/:/g, "_")}.json`;
function syncFiles(plan) {
  return /* @__PURE__ */ new Set(["meta.json", ...plan.phases.map((p) => phaseFile(p.id))]);
}
var isSyncBatch = (name) => name === "meta.json" || /^plan-.+\.json$/.test(name);

// src/cli/doctor.ts
var import_node_fs = require("node:fs");
var import_node_path = __toESM(require("node:path"), 1);
var ROADMAP_COLLECTIONS = ["state", "sessions", "messages", "notes", "plan", "meta", "events", "proposals", "approvals", "runs"];
var entries = (dir) => {
  try {
    return (0, import_node_fs.lstatSync)(dir).isDirectory() ? (0, import_node_fs.readdirSync)(dir, { withFileTypes: true }) : [];
  } catch {
    return [];
  }
};
var isFile = (f) => {
  try {
    return (0, import_node_fs.lstatSync)(f).isFile();
  } catch {
    return false;
  }
};
var isFolder = (f) => {
  try {
    return (0, import_node_fs.lstatSync)(f).isDirectory();
  } catch {
    return false;
  }
};
function removeLeftovers(root, leftovers, rm = import_node_fs.rmSync) {
  const removed = [];
  const failed = [];
  for (const l3 of leftovers) {
    try {
      rm(import_node_path.default.join(root, l3.path), { recursive: true, force: true });
      removed.push(l3.path);
    } catch (e) {
      failed.push({ path: l3.path, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { removed, failed };
}
function leftoversOf(root, plan) {
  const top = import_node_path.default.join(root, ".waypoint");
  const wp = import_node_path.default.join(top, plan.project);
  if (!isFolder(top) || !isFolder(wp)) return [];
  const rel = (p) => import_node_path.default.relative(root, p).split(import_node_path.default.sep).join("/");
  const out = [];
  const seats = [wp, ...entries(import_node_path.default.join(wp, "seats")).filter((d) => d.isDirectory()).map((d) => import_node_path.default.join(wp, "seats", d.name))];
  for (const seat of seats) {
    const f = import_node_path.default.join(seat, "last-head");
    if (isFile(f)) out.push({ path: rel(f), why: "replaced by last-head.json" });
  }
  const keep = syncFiles(plan);
  for (const d of entries(import_node_path.default.join(wp, "sync"))) {
    if (d.isFile() && d.name.endsWith(".json") && !keep.has(d.name)) out.push({ path: rel(import_node_path.default.join(wp, "sync", d.name)), why: "a batch this plan no longer writes" });
  }
  for (const d of entries(import_node_path.default.join(wp, "dbcache"))) {
    if (d.isDirectory() && !ROADMAP_COLLECTIONS.includes(d.name)) {
      out.push({ path: rel(import_node_path.default.join(wp, "dbcache", d.name)), why: "a collection the roadmap does not have" });
    }
  }
  return out;
}

// src/cli/run.ts
var import_node_child_process4 = require("node:child_process");

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
  util2.assertEqual = (_2) => {
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
    const validKeys = util2.objectKeys(obj).filter((k2) => typeof obj[obj[k2]] !== "number");
    const filtered = {};
    for (const k2 of validKeys) {
      filtered[k2] = obj[k2];
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
  util2.find = (arr2, checker) => {
    for (const item of arr2) {
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
  util2.jsonStringifyReplacer = (_2, value) => {
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
  const { data, path: path11, errorMaps, issueData } = params;
  const fullPath = [...path11, ...issueData.path || []];
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
    ].filter((x2) => !!x2)
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
    for (const s of results) {
      if (s.status === "aborted")
        return INVALID;
      if (s.status === "dirty")
        status.dirty();
      arrayValue.push(s.value);
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
var isAborted = (x2) => x2.status === "aborted";
var isDirty = (x2) => x2.status === "dirty";
var isValid = (x2) => x2.status === "valid";
var isAsync = (x2) => typeof Promise !== "undefined" && x2 instanceof Promise;

// node_modules/zod/v3/helpers/errorUtil.js
var errorUtil;
(function(errorUtil2) {
  errorUtil2.errToObj = (message) => typeof message === "string" ? { message } : message || {};
  errorUtil2.toString = (message) => typeof message === "string" ? message : message?.message;
})(errorUtil || (errorUtil = {}));

// node_modules/zod/v3/types.js
var ParseInputLazyPath = class {
  constructor(parent, value, path11, key) {
    this._cachedPath = [];
    this.parent = parent;
    this.data = value;
    this._path = path11;
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
    }).filter((x2) => !!x2);
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
ZodTuple.create = (schemas5, params) => {
  if (!Array.isArray(schemas5)) {
    throw new Error("You must pass an array of schemas to z.tuple([ ... ])");
  }
  return new ZodTuple({
    items: schemas5,
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
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x2) => !!x2),
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
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x2) => !!x2),
        issueData: {
          code: ZodIssueCode.invalid_return_type,
          returnTypeError: error
        }
      });
    }
    const params = { errorMap: ctx.common.contextualErrorMap };
    const fn2 = ctx.data;
    if (this._def.returns instanceof ZodPromise) {
      const me2 = this;
      return OK(async function(...args) {
        const error = new ZodError([]);
        const parsedArgs = await me2._def.args.parseAsync(args, params).catch((e) => {
          error.addIssue(makeArgsIssue(args, e));
          throw error;
        });
        const result = await Reflect.apply(fn2, this, parsedArgs);
        const parsedReturns = await me2._def.returns._def.type.parseAsync(result, params).catch((e) => {
          error.addIssue(makeReturnsIssue(result, e));
          throw error;
        });
        return parsedReturns;
      });
    } else {
      const me2 = this;
      return OK(function(...args) {
        const parsedArgs = me2._def.args.safeParse(args, params);
        if (!parsedArgs.success) {
          throw new ZodError([makeArgsIssue(args, parsedArgs.error)]);
        }
        const result = Reflect.apply(fn2, this, parsedArgs.data);
        const parsedReturns = me2._def.returns.safeParse(result, params);
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
var BRAND = /* @__PURE__ */ Symbol("zod_brand");
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
  string: ((arg) => ZodString.create({ ...arg, coerce: true })),
  number: ((arg) => ZodNumber.create({ ...arg, coerce: true })),
  boolean: ((arg) => ZodBoolean.create({
    ...arg,
    coerce: true
  })),
  bigint: ((arg) => ZodBigInt.create({ ...arg, coerce: true })),
  date: ((arg) => ZodDate.create({ ...arg, coerce: true }))
};
var NEVER = INVALID;

// src/lib/types.ts
var TASK_STATUSES = ["free", "claimed", "in_progress", "blocked", "done", "orphaned"];
var TRACK_COLORS = ["blue", "mauve", "teal", "pink", "sky", "flamingo"];
var STAGES = ["brief", "implement", "validate", "verify", "review", "verdict", "integrate"];

// src/lib/ids.ts
var BAD = /[^A-Za-z0-9_.-]+/g;
var START = /^[-.]+/;
var END = /[-.]+$/;
function sessionIdFrom(name) {
  const mapped = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(BAD, "-");
  const s = mapped.replace(START, "").slice(0, 40).replace(END, "");
  return s || "main";
}
function compactTs(d) {
  return d.toISOString().replace(/[-:]/g, "").replace(".", "");
}
function eventId(d, sessionId, rand = Math.random) {
  const r2 = Math.floor(rand() * 36 ** 4).toString(36).padStart(4, "0");
  return `${compactTs(d)}-${sessionId}-${r2}`;
}
function eventIds(d, sessionId, n, rand = Math.random) {
  return Array.from({ length: n }, (_2, i) => eventId(new Date(d.getTime() + i), sessionId, rand));
}
var realDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && (/* @__PURE__ */ new Date(`${v}T00:00:00Z`)).toISOString().slice(0, 10) === v;
var PLAN_ID_RE = /^[A-Za-z0-9_.-]{1,64}$/;
var isPlanId = (s) => PLAN_ID_RE.test(s) && s !== "." && s !== "..";

// src/lib/plan.ts
function planSchemas() {
  const id = external_exports.string().regex(PLAN_ID_RE, "invalid id (allowed: letters, digits, _ - .; max 64)").refine((s) => s !== "." && s !== "..", "invalid id");
  const TaskSchema = external_exports.object({
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
    estimate_min: external_exports.number().positive().optional(),
    delicate: external_exports.boolean().optional(),
    // G-25, K3-08: the section of the design the task comes from (a heading's slug, or _intro).
    design_ref: external_exports.string().regex(/^[a-z0-9-]{1,80}$|^_intro$/, "design_ref must be a section slug of the design").optional()
  });
  const PlanSchema = external_exports.object({
    project: id,
    locale: external_exports.string().min(1).default("en"),
    version: external_exports.string().min(1),
    design_version: external_exports.number().int().positive().optional(),
    artifacts: external_exports.object({ roadmap: external_exports.string().url().optional(), design: external_exports.string().url().optional() }).default({}),
    versions: external_exports.array(external_exports.object({ id, phases: external_exports.array(id), target: external_exports.string().refine(realDate, "target must be a date (YYYY-MM-DD)").optional() })).default([]),
    tracks: external_exports.array(external_exports.object({ id, name: external_exports.string().min(1), color: external_exports.enum(TRACK_COLORS) })).min(1),
    phases: external_exports.array(external_exports.object({
      id,
      name: external_exports.string().min(1),
      plan_status: external_exports.enum(["committed", "provisional"]).default("committed"),
      goal: external_exports.string().max(300).optional()
    })).min(1),
    tasks: external_exports.array(TaskSchema).min(1)
  });
  return { TaskSchema, PlanSchema };
}
var planBuilt;
var schemas = () => planBuilt ??= planSchemas();
var PlanError = class extends Error {
  constructor(issues) {
    super(`Invalid plan:
- ${issues.join("\n- ")}`);
    this.issues = issues;
    this.name = "PlanError";
  }
  issues;
};
function parsePlan(text) {
  let raw;
  try {
    raw = (0, import_yaml.parse)(text);
  } catch (e) {
    throw new PlanError([`YAML: ${e.message}`]);
  }
  const r2 = schemas().PlanSchema.safeParse(raw);
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
  for (const [kind, list] of lists) for (const d of dupes(list.map((x2) => x2.id))) issues.push(`duplicate ${kind} id: ${d}`);
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

// src/lib/sync.ts
var import_node_crypto = require("node:crypto");

// src/lib/waypoint-version.ts
var WAYPOINT_VERSION = true ? "0.31.0" : "0.0.0";
var VERSION = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})/;
var partsOf = (v) => {
  const m = typeof v === "string" ? VERSION.exec(v) : null;
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
};
function compareVersions(a, b) {
  const x2 = partsOf(a), y2 = partsOf(b);
  for (let i = 0; i < 3; i++) if (x2[i] !== y2[i]) return x2[i] < y2[i] ? -1 : 1;
  return 0;
}

// src/lib/sync.ts
function planHash(plan) {
  const { artifacts: _ignored, ...rest } = plan;
  return (0, import_node_crypto.createHash)("sha256").update(JSON.stringify(rest)).digest("hex").slice(0, 16);
}
function buildDocs(plan, nowIso) {
  const links = plan.artifacts.design || plan.design_version ? { ...plan.artifacts.design ? { design: plan.artifacts.design } : {}, ...plan.design_version ? { designVersion: plan.design_version } : {} } : null;
  return {
    meta: {
      name: plan.project,
      locale: plan.locale,
      version: plan.version,
      planHash: planHash(plan),
      tracks: plan.tracks,
      versions: plan.versions,
      phaseOrder: plan.phases.map((p) => p.id),
      metrics: {},
      syncedAt: nowIso,
      waypointVersion: WAYPOINT_VERSION,
      ...links ? { links } : {}
    },
    phases: plan.phases.map((p, i) => ({
      id: p.id,
      name: p.name,
      plan_status: p.plan_status,
      ...p.goal ? { goal: p.goal } : {},
      order: i,
      tasks: plan.tasks.filter((t) => t.phase === p.id)
    }))
  };
}
function uniquePhases(phases, dropped) {
  const seen = /* @__PURE__ */ new Set();
  return phases.filter((p, i) => {
    if (!seen.has(p.id)) return !!seen.add(p.id);
    dropped?.(i);
    return false;
  });
}
function planViewFromDocs(meta, phases) {
  const ordered = uniquePhases(phases).sort((a, b) => a.order - b.order);
  return {
    tracks: meta.tracks,
    versions: meta.versions,
    phases: ordered.map(({ id, name, plan_status, goal }) => ({ id, name, plan_status, ...goal ? { goal } : {} })),
    tasks: ordered.flatMap((p) => p.tasks)
  };
}
var DEL = { __delete__: true };
function buildSyncWrites(plan, known, outDir, opts) {
  const k2 = (c) => known[c] ?? {};
  const { meta, phases } = buildDocs(plan, opts.nowIso);
  const files = {};
  const file = (name, body) => {
    const p = `${outDir.replace(/[\\/]+$/, "")}/${name}`;
    files[p] = body;
    return p;
  };
  const writes = [];
  const metaV = k2("meta").project;
  const { metrics: _keep, ...rest } = meta;
  const metaWrite = metaV ? { op: "update", collection: "meta", doc_id: "project", file_path: file("meta.json", rest), if_version: metaV } : { op: "set", collection: "meta", doc_id: "project", file_path: file("meta.json", meta) };
  for (const ph of phases) {
    const v = k2("plan")[ph.id];
    writes.push({ op: "set", collection: "plan", doc_id: ph.id, file_path: file(`plan-${ph.id.replace(/:/g, "_")}.json`, ph), ...v ? { if_version: v } : {} });
  }
  for (const [id, v] of Object.entries(k2("plan"))) {
    if (!phases.some((p) => p.id === id)) writes.push({ op: "delete", collection: "plan", doc_id: id, if_version: v });
  }
  const taskIds = new Set(plan.tasks.map((t) => t.id));
  const listed = opts.listed ? new Set(opts.listed) : null;
  const removed = [], unknownVersion = [], needsList = [];
  for (const t of plan.tasks) {
    const v = k2("state")[t.id];
    const st2 = opts.states?.[t.id];
    if (!v) {
      if (listed?.has(t.id)) {
        unknownVersion.push(t.id);
        if (st2?.status === "orphaned") needsList.push(t.id);
        continue;
      }
      writes.push({ op: "set", collection: "state", doc_id: t.id, data: { status: "free" } });
    } else if (st2?.status === "orphaned") {
      writes.push(st2.prevStatus === "done" ? { op: "update", collection: "state", doc_id: t.id, data: { status: "done", prevStatus: DEL }, if_version: v } : { op: "update", collection: "state", doc_id: t.id, data: { status: "free", owner: DEL, claimedAt: DEL, startedAt: DEL, doneAt: DEL, blockedBy: DEL, blockedReason: DEL, prevStatus: DEL }, if_version: v });
    }
  }
  for (const [id, v] of Object.entries(k2("state"))) {
    const st2 = opts.states?.[id];
    if (taskIds.has(id) || st2?.status === "orphaned") continue;
    writes.push({ op: "update", collection: "state", doc_id: id, data: { status: "orphaned", ...st2?.status ? { prevStatus: st2.status } : {} }, if_version: v });
    removed.push(id);
  }
  if (listed) for (const id of listed) {
    if (!taskIds.has(id) && !k2("state")[id] && opts.states?.[id]?.status !== "orphaned") {
      unknownVersion.push(id);
      needsList.push(id);
    }
  }
  if (!opts.planSynced) {
    writes.push({
      op: "set",
      collection: "events",
      doc_id: opts.eventId,
      data: { ts: opts.nowIso, type: "plan_changed", sessionId: opts.sessionId, text: `plan ${meta.planHash}` }
    });
  }
  writes.push(metaWrite);
  const missing = listed ? plan.tasks.filter((t) => !listed.has(t.id)).map((t) => t.id) : [];
  return { files, batches: chunk(writes, files), removed, missing, unknownVersion, needsList };
}
function chunk(writes, files, max = 50, maxBytes = 9e5) {
  const out = [];
  let cur = [];
  let bytes = 0;
  for (const w of writes) {
    const size = JSON.stringify(w.file_path ? files[w.file_path] : w.data ?? {}).length + 200;
    if (cur.length && (cur.length >= max || bytes + size > maxBytes)) {
      out.push(cur);
      cur = [];
      bytes = 0;
    }
    cur.push(w);
    bytes += size;
  }
  if (cur.length) out.push(cur);
  return out;
}

// src/lib/decisions.ts
var DECISION_POINTS = ["route", "triage", "design-apply", "design-approve", "plan-confirm", "mode", "ruling", "safe-path", "takeover", "revert", "other"];
var LIMITS = { what: 200, chosen: 200, alternative: 200, alternatives: 10, why: 500, revert: 500, safePath: 200, reason: 300 };
var DECISIONS_MAX = 16 * 1024;
var DECISIONS_WINDOW_MS = 24 * 36e5;
var FUTURE_SKEW_MS = 5 * 6e4;
var cp = (n) => String.fromCharCode(n);
var UNSAFE = new RegExp(`[\\x00-\\x1f\\x7f-\\x9f${cp(8234)}-${cp(8238)}${cp(8294)}-${cp(8297)}]`, "g");
var clean = (s, max) => {
  const t = s.replace(UNSAFE, " ").replace(/\s+/g, " ").trim();
  return t.length <= max ? t : Array.from(t).slice(0, max).join("");
};

// src/lib/notes.ts
var NOTE_TYPES = ["decision", "idea", "debt", "question"];
var MAX_NOTE = 2e3;
var MAX_NAME = 80;
var SAY_MAX = 200;
var str = (x2) => typeof x2 === "string";
var NOTE_ID = /^[A-Za-z0-9_.:~@+-]{1,160}$/;
var clipPoints = (s, max) => s.length <= max ? s : Array.from(s).slice(0, max).join("");
function normalizeNote(x2) {
  if (!x2 || typeof x2 !== "object" || Array.isArray(x2)) return null;
  const o = x2;
  if (!str(o.type) || !NOTE_TYPES.includes(o.type)) return null;
  if (!str(o.author) || !str(o.text)) return null;
  const out = { ts: str(o.ts) ? o.ts : "", type: o.type, author: o.author, text: clipPoints(o.text, MAX_NOTE) };
  if (str(o.taskId)) out.taskId = o.taskId;
  if (str(o.answer)) out.answer = clipPoints(o.answer, MAX_NOTE);
  if (str(o.answeredBy)) out.answeredBy = o.answeredBy;
  if (str(o.answeredAt)) out.answeredAt = o.answeredAt;
  if (str(o.answeredByNote) && NOTE_ID.test(o.answeredByNote)) out.answeredByNote = o.answeredByNote;
  if (str(o.authorName) && o.authorName.trim()) out.authorName = clean(o.authorName, MAX_NAME);
  if (str(o.answeredByName) && o.answeredByName.trim()) out.answeredByName = clean(o.answeredByName, MAX_NAME);
  if (str(o.proposalId) && o.proposalId && !o.proposalId.includes("/")) out.proposalId = o.proposalId;
  const decision = normalizeNoteDecision(o.decision);
  if (decision) out.decision = decision;
  return out;
}
function normalizeNoteDecision(x2) {
  if (!x2 || typeof x2 !== "object" || Array.isArray(x2)) return null;
  const o = x2;
  if (!str(o.point) || !DECISION_POINTS.includes(o.point)) return null;
  const line3 = (v, max) => str(v) ? clean(v, max) : "";
  const what = line3(o.what, LIMITS.what);
  const chosen = line3(o.chosen, LIMITS.chosen);
  const why = line3(o.why, LIMITS.why);
  if (!what || !chosen || !why) return null;
  const out = { point: o.point, what, chosen, why, auto: o.auto === true };
  const alternatives = Array.isArray(o.alternatives) ? o.alternatives.map((a) => line3(a, LIMITS.alternative)).filter(Boolean).slice(0, LIMITS.alternatives) : [];
  if (alternatives.length) out.alternatives = alternatives;
  const revert = line3(o.revert, LIMITS.revert);
  if (revert) out.revert = revert;
  return out;
}
var time = (s) => {
  const t = s ? Date.parse(s) : NaN;
  return Number.isNaN(t) ? -Infinity : t;
};
function notesSince(notes, since) {
  const s = since ? Date.parse(since) : NaN;
  const valid = !Number.isNaN(s);
  const kept = notes.filter((n) => {
    if (!valid) return n.author.startsWith("user:");
    if (n.author.startsWith("user:") && time(n.ts) > s) return true;
    return n.type === "question" && !!n.answer && time(n.answeredAt) > s;
  });
  const key = (n) => Math.max(time(n.ts), time(n.answeredAt));
  return kept.map((n, i) => ({ n, i })).sort((a, b) => {
    const ta = key(a.n);
    const tb = key(b.n);
    if (ta === tb) return a.i - b.i;
    return ta > tb ? 1 : -1;
  }).map((x2) => x2.n);
}
var SAY = {
  es: {
    note: (who, text) => `Nota de ${who ?? "una persona"} en el roadmap: \xAB${text}\xBB`,
    answer: (who, text) => `Respuesta de ${who ?? "una persona"} en el roadmap: \xAB${text}\xBB`
  },
  en: {
    note: (who, text) => `${who ? `${who}'s` : "Someone's"} note on the roadmap: "${text}"`,
    answer: (who, text) => `${who ? `${who}'s` : "Someone's"} answer on the roadmap: "${text}"`
  }
};
function sayText(s) {
  const chars = Array.from(s.replace(/\s+/g, " ").trim());
  return chars.length <= SAY_MAX ? chars.join("") : chars.slice(0, SAY_MAX - 1).join("") + "\u2026";
}
function noteLines(notes, since, locale, taskIds) {
  const s = since ? Date.parse(since) : NaN;
  const fresh = (ts) => Number.isNaN(s) || time(ts) > s;
  const say = [];
  const mentions = [];
  const add = (line3, text) => {
    say.push(line3);
    mentions.push([...new Set([...text.matchAll(/\bT\d{3,}\b/g)].map((m) => m[0]))].filter((id) => taskIds.has(id)));
  };
  for (const n of notes) {
    if (n.author.startsWith("user:") && fresh(n.ts)) add(SAY[locale].note(n.authorName, sayText(n.text)), n.text);
    if (n.answer && n.answeredBy?.startsWith("user:") && fresh(n.answeredAt)) add(SAY[locale].answer(n.answeredByName, sayText(n.answer)), n.answer);
  }
  return { say, mentions };
}

// src/lib/deps.ts
var statusOf = (states, id) => states[id]?.status ?? "free";
function isUnlocked(task, states) {
  return task.depends_on.every((d) => statusOf(states, d) === "done");
}
function isAvailable(task, states) {
  const st2 = states[task.id];
  const status = statusOf(states, task.id);
  if (status === "free") return true;
  if (status !== "blocked") return false;
  const by = st2?.blockedBy ?? [];
  return by.length > 0 && !by.includes("external") && by.every((b) => statusOf(states, b) === "done");
}
function availableTasks(plan, states, opts = {}) {
  const order = new Map(plan.phases.map((p, i) => [p.id, i]));
  return plan.tasks.map((t, i) => ({ t, i })).filter(({ t }) => isAvailable(t, states) && isUnlocked(t, states) && (!opts.track || t.track === opts.track)).sort((a, b) => order.get(a.t.phase) - order.get(b.t.phase) || a.i - b.i).map((x2) => x2.t);
}
function nextTask(plan, states, opts) {
  const own = plan.tasks.find((t) => states[t.id]?.owner === opts.sessionId && ["claimed", "in_progress"].includes(statusOf(states, t.id)));
  if (own) return { task: own, resumed: true };
  return { task: availableTasks(plan, states, opts)[0] ?? null, resumed: false };
}
var commitShas = (states, id) => (Array.isArray(states[id]?.commits) ? states[id].commits : []).map((c) => c?.sha).filter((s) => typeof s === "string" && !!s);
function notIntegratedDep(plan, states, task, integrated) {
  return task.depends_on.find((d) => {
    const dep = plan.tasks.find((t) => t.id === d);
    return !!dep && dep.track !== task.track && !commitShas(states, d).every((s) => integrated.has(s));
  }) ?? null;
}

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
  for (const x2 of a) for (const y2 of b) if (globsOverlap(x2, y2)) out.push([x2, y2]);
  return out;
}
function effectiveZones(zones) {
  return zones.length ? [...zones] : ["**"];
}

// src/lib/coordination.ts
var IDLE_MINUTES = 15;
var LEASE_CAP_MINUTES = 90;
var LEASE_MINUTES = 10;
var SILENT_MINUTES = 5;
var ACTIVE = ["claimed", "in_progress"];
function zonesOf(task, state) {
  const touched = Array.isArray(state?.zonesTouched) ? state.zonesTouched : [];
  return [...effectiveZones(task.zones), ...touched].filter((z2) => typeof z2 === "string");
}
function conflictsFor(plan, states, taskId, sessionId, sessions, now = Date.now()) {
  const task = plan.tasks.find((t) => t.id === taskId);
  if (!task) return [];
  const mine = zonesOf(task, states[taskId]);
  const out = [];
  for (const other of plan.tasks) {
    const st2 = states[other.id];
    if (other.id === taskId || !st2?.owner || st2.owner === sessionId || !ACTIVE.includes(statusOf(states, other.id))) continue;
    const zones = overlappingZones(mine, zonesOf(other, st2));
    if (zones.length) out.push({ taskId: other.id, owner: st2.owner, zones, ...sessions ? { ownerIdle: isIdle(sessions[st2.owner], now) } : {} });
  }
  return out;
}
function pickTask(plan, states, opts) {
  const conflicts = (id) => conflictsFor(plan, states, id, opts.sessionId, opts.sessions, opts.now);
  const own = nextTask(plan, states, opts);
  if (own.resumed && own.task) {
    return { task: own.task, resumed: true, unblock: false, conflicts: conflicts(own.task.id) };
  }
  const open = availableTasks(plan, states, opts).filter((t) => {
    const owner = states[t.id]?.owner;
    return !owner || owner === opts.sessionId;
  });
  const waiting = [];
  if (opts.integrated) {
    for (const t of open) {
      const dep = notIntegratedDep(plan, states, t, opts.integrated);
      if (dep) waiting.push({ taskId: t.id, dependsOn: dep });
    }
  }
  const candidates = open.filter((t) => !waiting.some((w) => w.taskId === t.id));
  const extra = waiting.length ? { waiting_on: waiting } : {};
  const result = (task, conflicts2) => ({ task, resumed: false, unblock: statusOf(states, task.id) === "blocked", conflicts: conflicts2, ...extra });
  for (const c of candidates) {
    const cs = conflicts(c.id);
    if (!cs.some((x2) => !x2.ownerIdle)) return result(c, cs);
  }
  const first = candidates[0];
  return first ? result(first, conflicts(first.id)) : { task: null, resumed: false, unblock: false, conflicts: [], ...extra };
}
function leaseOf(s, beatMinutes = LEASE_MINUTES) {
  if (!s) return null;
  const t = (x2) => typeof x2 === "string" ? Date.parse(x2) : NaN;
  const beat = t(s.heartbeatAt);
  const busy = t(s.busyUntil);
  const all = [t(s.leaseUntil), beat + beatMinutes * 6e4, busy - beat <= LEASE_CAP_MINUTES * 6e4 ? busy : NaN].filter(Number.isFinite);
  return all.length ? Math.max(...all) : null;
}
function isIdle(s, now, minutes = IDLE_MINUTES) {
  return !s || s.status === "idle" || liveness(now, leaseOf(s, Math.max(0, minutes - SILENT_MINUTES))) === "stopped";
}
function liveness(now, leaseUntil) {
  const until = typeof leaseUntil === "number" ? leaseUntil : typeof leaseUntil === "string" ? Date.parse(leaseUntil) : NaN;
  if (!Number.isFinite(until)) return "stopped";
  if (now < until) return "alive";
  return now - until < SILENT_MINUTES * 6e4 ? "silent" : "stopped";
}
function recoverableTasks(plan, states, sessions, now, minutes = IDLE_MINUTES) {
  return plan.tasks.filter((t) => ACTIVE.includes(statusOf(states, t.id)) && states[t.id]?.owner && isIdle(sessions[states[t.id].owner], now, minutes)).map((t) => ({ taskId: t.id, owner: states[t.id].owner }));
}
function inboxFor(messages, sessionId) {
  return Object.entries(messages).filter((e) => !!e[1]).filter(([, m]) => m.status === "open" && m.from !== sessionId && (m.to === sessionId || m.to === "*")).map(([id, m]) => ({ ...m, id })).sort((a, b) => {
    const ta = String(a.ts ?? ""), tb = String(b.ts ?? "");
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });
}
function threadKey(m) {
  return `${m.taskId ?? "-"}|${[String(m.from), String(m.to)].sort().join("|")}`;
}
function escalationCandidates(messages) {
  const threads = /* @__PURE__ */ new Map();
  for (const m of Object.values(messages)) {
    if (!m || m.type === "delegate" || m.to === "*" || m.from === "*") continue;
    const k2 = threadKey(m);
    threads.set(k2, [...threads.get(k2) ?? [], m]);
  }
  const out = [];
  for (const [key, list] of threads) {
    if (list.some((m) => m.type === "escalation")) continue;
    const open = list.filter((m) => m.status === "open");
    if (open.length < 4) continue;
    const [a, b] = [String(list[0].from), String(list[0].to)].sort();
    out.push({ key, taskId: list[0].taskId ?? "", sessions: [a, b], count: open.length });
  }
  return out;
}

// src/lib/batches.ts
var REASON_MAX = 300;
var SUMMARY_MAX = 300;
var DEL2 = { __delete__: true };
var MIN = 6e4;
var iso = (ms) => new Date(ms).toISOString();
var BIDI = new RegExp(`[${[1564, 8206, 8207, 8234, 8235, 8236, 8237, 8238, 8294, 8295, 8296, 8297].map((c) => String.fromCharCode(c)).join("")}]`, "g");
var CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
var clipPoints2 = (text, max) => text.length <= max ? text : Array.from(text).slice(0, max).join("");
function cleanText(text, max) {
  return clipPoints2(text.replace(CONTROL, " ").replace(BIDI, "").replace(/\s+/g, " ").trim(), max);
}
var event = (doc_id, data) => ({ op: "set", collection: "events", doc_id, data });
function claimBatch(i) {
  const now = i.now.toISOString();
  const leaseUntil = iso(i.now.getTime() + LEASE_MINUTES * MIN);
  const data = { status: "in_progress", owner: i.sid, claimedAt: now, startedAt: now };
  if (i.recoveredFrom) data.recoveredFrom = i.recoveredFrom;
  else data.zonesTouched = [];
  if (i.unblock) {
    data.blockedBy = DEL2;
    data.blockedReason = DEL2;
  }
  const eids = i.eids.slice(0, i.unblock ? 2 : 1);
  const started = eids[eids.length - 1];
  const base = { ts: now, sessionId: i.sid, taskId: i.task };
  return {
    now,
    eid: eids[0],
    eids,
    leaseUntil,
    batch: [
      { op: "update", collection: "state", doc_id: i.task, data, if_version: i.stateVersion },
      ...i.unblock ? [event(eids[0], { ...base, type: "unblocked" })] : [],
      event(started, { ...base, type: "started", ...i.recoveredFrom ? { text: `recovered from ${i.recoveredFrom}` } : {} }),
      { op: "update", collection: "sessions", doc_id: i.sid, data: { currentTask: i.task, heartbeatAt: now, leaseUntil, status: "active" }, if_version: i.sessionVersion }
    ]
  };
}
function doneBatch(i) {
  const now = i.now.toISOString();
  const leaseUntil = iso(i.now.getTime() + LEASE_MINUTES * MIN);
  const eid = i.eids[0];
  const c = i.commit;
  return {
    now,
    eid,
    eids: [eid],
    leaseUntil,
    batch: [
      { op: "update", collection: "state", doc_id: i.task, data: { status: "done", doneAt: now, commits: [c], summary: cleanText(i.summary, SUMMARY_MAX) }, if_version: i.stateVersion },
      event(eid, { ts: now, type: "done", sessionId: i.sid, taskId: i.task, text: cleanText(c.title, SUMMARY_MAX), add: c.add, del: c.del, sha: c.sha }),
      { op: "update", collection: "sessions", doc_id: i.sid, data: { currentTask: DEL2, heartbeatAt: now, leaseUntil }, if_version: i.sessionVersion }
    ],
    metrics: { op: "update", collection: "meta", doc_id: "metrics", data: { lastCommit: { sha: c.sha, ts: c.ts }, ...i.tests !== void 0 ? { tests: i.tests } : {}, updatedAt: now } }
  };
}
function blockBatch(i) {
  const now = i.now.toISOString();
  const leaseUntil = iso(i.now.getTime() + LEASE_MINUTES * MIN);
  const eid = i.eids[0];
  const reason = cleanText(i.reason, REASON_MAX);
  return {
    now,
    eid,
    eids: [eid],
    leaseUntil,
    batch: [
      { op: "update", collection: "state", doc_id: i.task, data: { status: "blocked", blockedBy: [...i.by], blockedReason: reason }, if_version: i.stateVersion },
      event(eid, { ts: now, type: "blocked", sessionId: i.sid, taskId: i.task, text: reason }),
      { op: "update", collection: "sessions", doc_id: i.sid, data: { currentTask: DEL2, heartbeatAt: now, leaseUntil }, if_version: i.sessionVersion }
    ]
  };
}
function heartbeatBatch(i) {
  const t = i.now.getTime();
  const now = i.now.toISOString();
  const busy = i.busyUntil ? i.busyUntil.getTime() : NaN;
  const until = i.idle ? t : Number.isFinite(busy) ? Math.max(t + LEASE_MINUTES * MIN, Math.min(busy, t + LEASE_CAP_MINUTES * MIN)) : t + LEASE_MINUTES * MIN;
  const leaseUntil = iso(until);
  return {
    now,
    eid: null,
    eids: [],
    leaseUntil,
    batch: [{ op: "update", collection: "sessions", doc_id: i.sid, data: { heartbeatAt: now, leaseUntil, status: i.idle ? "idle" : "active" }, if_version: i.sessionVersion }]
  };
}
function registerBatch(i) {
  const now = i.now.toISOString();
  const leaseUntil = iso(i.now.getTime() + LEASE_MINUTES * MIN);
  const data = { name: i.name, track: i.track, agentName: i.agent, branch: i.branch, worktree: i.worktree, ...i.claude ? { claude: i.claude } : {}, heartbeatAt: now, leaseUntil, status: "active" };
  const write = i.sessionVersion === null ? { op: "set", collection: "sessions", doc_id: i.sid, data } : { op: "update", collection: "sessions", doc_id: i.sid, data, if_version: i.sessionVersion };
  return { now, eid: null, eids: [], leaseUntil, batch: [write] };
}
function freeBatch(i) {
  return [
    { op: "update", collection: "state", doc_id: i.task, data: { status: "free", owner: DEL2, claimedAt: DEL2, startedAt: DEL2 }, if_version: i.stateVersion },
    ...i.sessionVersion !== null ? [{ op: "update", collection: "sessions", doc_id: i.sid, data: i.keepSeat ? { currentTask: DEL2 } : { currentTask: DEL2, status: "idle" }, if_version: i.sessionVersion }] : []
  ];
}

// src/lib/roadmap-doc.ts
var ROUNDS_MAX = 6;
var VALIDATORS_MAX = 10;
var DEFERRED_MAX = 10;
var NOTE_MAX = 120;
var PROBLEM_MAX = 160;
var UNCHECKED_MAX = 10;
var TEXT_MAX = 200;
var NAME_MAX = 80;
var REVIEWER_MAX = 40;
var REVIEWERS_MAX = 6;
var COUNT_MAX = 999;
var DOC_PATHS = ["trivial", "small", "medium", "large"];
var DOC_STAGES = [...STAGES, "triage", "done", "blocked", "stopped"];
var ACTIONS = ["accept", "fix", "redo"];
var STAGE_KEYS = [...STAGES, "triage"];
var isObj = (x2) => typeof x2 === "object" && x2 !== null && !Array.isArray(x2);
var kindOf = (v) => v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
var int = (v, min, max) => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
var iso2 = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v));
var isAction = (v) => ACTIONS.includes(v);
var BIDI2 = new RegExp(`[${[1564, 8206, 8207, 8234, 8235, 8236, 8237, 8238, 8294, 8295, 8296, 8297].map((c) => String.fromCharCode(c)).join("")}]`, "g");
var CONTROL2 = /[\u0000-\u001f\u007f-\u009f]/g;
var clip = (v, max) => v.length <= max ? v : Array.from(v).slice(0, max).join("");
var line = (v, max) => clip(v.replace(CONTROL2, " ").replace(BIDI2, "").trim(), max);
function validatorOf(v) {
  if (!isObj(v) || typeof v.name !== "string" || !v.name.trim() || typeof v.ok !== "boolean") return null;
  const out = { name: line(v.name, NAME_MAX), ok: v.ok };
  if (v.flaky === true) out.flaky = true;
  if (typeof v.skipped === "string" && v.skipped.trim()) out.skipped = line(v.skipped, NAME_MAX);
  if (v.preexisting === true) out.preexisting = true;
  if (int(v.ms, 0, 864e5)) out.ms = v.ms;
  if (v.cached === true) out.cached = true;
  if (int(v.failing, 0, 1e5)) out.failing = v.failing;
  return out;
}
function roundOf(r2) {
  if (!isObj(r2) || !int(r2.brief, 1, 9999) || !int(r2.n, 1, 99) || !isAction(r2.action) || typeof r2.note !== "string" || !iso2(r2.at)) return null;
  const f = isObj(r2.findings) ? r2.findings : {};
  const c = (k2) => int(f[k2], 0, COUNT_MAX) ? f[k2] : null;
  const findings = { critical: c("critical"), important: c("important"), minor: c("minor"), deferred: c("deferred") };
  if (Object.values(findings).some((x2) => x2 === null)) return null;
  const reviewers = (Array.isArray(r2.reviewers) ? r2.reviewers : []).filter((x2) => typeof x2 === "string" && !!x2.trim()).map((x2) => line(x2, REVIEWER_MAX)).slice(0, REVIEWERS_MAX);
  return { brief: r2.brief, n: r2.n, action: r2.action, note: line(r2.note, NOTE_MAX), findings, reviewers, at: r2.at };
}
function deferredOf(d) {
  if (!isObj(d) || typeof d.problem !== "string" || !d.problem.trim()) return null;
  const out = { problem: line(d.problem, PROBLEM_MAX) };
  if (typeof d.file === "string" && d.file.trim()) out.file = line(d.file, TEXT_MAX);
  if (int(d.line, 1, 1e7)) out.line = d.line;
  return out;
}
function verifyOf(v, report) {
  if (typeof v.planned !== "boolean") {
    report?.("forge.verify", "coerced", "planned");
    return null;
  }
  return {
    planned: v.planned,
    result: v.result === "pass" || v.result === "fail" || v.result === "blocked" ? v.result : null,
    passed: int(v.passed, 0, 1e3) ? v.passed : null,
    total: int(v.total, 0, 1e3) ? v.total : null,
    skipped: typeof v.skipped === "string" && v.skipped.trim() ? line(v.skipped, TEXT_MAX) : null,
    surfaces: (Array.isArray(v.surfaces) ? v.surfaces : []).filter((s) => typeof s === "string" && !!s.trim()).map((s) => line(s, NAME_MAX)).slice(0, 10)
  };
}
var SHA = /^[0-9a-f]{7,40}$/i;
function integrationOf(v, report) {
  if (typeof v.branch !== "string" || !v.branch.trim() || typeof v.target !== "string" || !v.target.trim() || typeof v.merged !== "boolean") {
    report?.("forge.integration", "coerced", "branch, target or merged");
    return null;
  }
  return { branch: line(v.branch, TEXT_MAX), sha: typeof v.sha === "string" && SHA.test(v.sha) ? v.sha : null, merged: v.merged, target: line(v.target, TEXT_MAX) };
}
function stagesOf(x2) {
  const out = {};
  for (const k2 of STAGE_KEYS) {
    const v = x2[k2];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[k2] = Math.round(v);
  }
  return out;
}
function parseForgeDocV2(x2, report) {
  const bad = (why) => {
    report?.("forge.v", "dropped", why);
    return null;
  };
  if (!isObj(x2)) return bad(kindOf(x2));
  if (x2.v !== 2) return bad("no v: 2");
  if (!DOC_PATHS.includes(x2.path)) return bad("path");
  if (!DOC_STAGES.includes(x2.stage)) return bad("stage");
  if (typeof x2.phase !== "string") return bad("phase");
  if (!int(x2.brief, 1, 9999)) return bad("brief");
  if (!Array.isArray(x2.rounds) || !Array.isArray(x2.validators) || !Array.isArray(x2.deferred) || !isObj(x2.stages)) return bad("rounds, validators, deferred or stages");
  if (x2.verify !== null && !isObj(x2.verify)) return bad("verify");
  if (x2.integration !== null && !isObj(x2.integration)) return bad("integration");
  if (x2.acceptedRound !== null && !int(x2.acceptedRound, 1, 99)) return bad("acceptedRound");
  if (typeof x2.overCap !== "boolean" || !iso2(x2.updatedAt)) return bad("overCap or updatedAt");
  const keep = (list, of, field2, max, newest2 = false) => {
    const out = [];
    list.forEach((v, i) => {
      const o = of(v);
      if (o) out.push(o);
      else report?.(`forge.${field2}[${i}]`, "dropped", kindOf(v));
    });
    return newest2 ? out.slice(-max) : out.slice(0, max);
  };
  const doc = {
    v: 2,
    path: x2.path,
    phase: line(x2.phase, 40),
    validators: keep(x2.validators, validatorOf, "validators", VALIDATORS_MAX),
    brief: x2.brief,
    stage: x2.stage,
    rounds: keep(x2.rounds, roundOf, "rounds", ROUNDS_MAX, true),
    verify: x2.verify === null ? null : verifyOf(x2.verify, report),
    stages: stagesOf(x2.stages),
    integration: x2.integration === null ? null : integrationOf(x2.integration, report),
    deferred: keep(x2.deferred, deferredOf, "deferred", DEFERRED_MAX),
    acceptedRound: x2.acceptedRound,
    overCap: x2.overCap,
    updatedAt: x2.updatedAt
  };
  const coerced = (field2, v) => report?.(`forge.${field2}`, "coerced", kindOf(v));
  if (typeof x2.agent === "string" && x2.agent.trim()) doc.agent = line(x2.agent, NAME_MAX);
  else if (x2.agent !== void 0) coerced("agent", x2.agent);
  if (isObj(x2.verdict) && isAction(x2.verdict.action)) {
    doc.verdict = { action: x2.verdict.action, score: typeof x2.verdict.score === "number" && Number.isFinite(x2.verdict.score) ? x2.verdict.score : null };
    if (doc.verdict.score === null && x2.verdict.score !== null) coerced("verdict", x2.verdict.score);
  } else if (x2.verdict !== void 0) coerced("verdict", x2.verdict);
  if (int(x2.round, 1, 99)) doc.round = x2.round;
  else if (x2.round !== void 0) coerced("round", x2.round);
  if (int(x2.cap, 1, 99)) doc.cap = x2.cap;
  else if (x2.cap !== void 0) coerced("cap", x2.cap);
  if (doc.round !== void 0 && doc.cap !== void 0 && doc.round > doc.cap) doc.overCap = true;
  return doc;
}

// src/page/normalize.ts
var isObj2 = (x2) => typeof x2 === "object" && x2 !== null && !Array.isArray(x2);
var str2 = (v) => String(v ?? "");
var optStr = (v) => typeof v === "string" ? v : void 0;
var arr = (v) => Array.isArray(v) ? v : [];
var strs = (v) => arr(v).filter((x2) => typeof x2 === "string");
var kindOf2 = (v) => v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
function keepAll(list, keep, field2, report) {
  const out = [];
  list.forEach((v, i) => {
    if (keep(v)) out.push(v);
    else report?.(`${field2}[${i}]`, "dropped", kindOf2(v));
  });
  return out;
}
var LINK_MAX = 500;
var NOT_IN_URL = new RegExp(`[\\s\\u0000-\\u001f\\u007f-\\u009f${[1564, 8206, 8207, 8234, 8235, 8236, 8237, 8238, 8294, 8295, 8296, 8297].map((c) => String.fromCharCode(c)).join("")}]`);
function linksOf(x2) {
  if (!isObj2(x2)) return {};
  const links = {};
  if (typeof x2.design === "string" && x2.design.startsWith("https://") && x2.design.length <= LINK_MAX && !NOT_IN_URL.test(x2.design)) links.design = x2.design;
  if (typeof x2.designVersion === "number" && Number.isInteger(x2.designVersion) && x2.designVersion > 0) links.designVersion = x2.designVersion;
  return Object.keys(links).length ? { links } : {};
}
function normalizeMeta(x2, report) {
  if (!isObj2(x2)) return null;
  const mt2 = isObj2(x2.metrics) ? x2.metrics : {};
  const metrics = { ...mt2 };
  const lc = mt2.lastCommit;
  if (isObj2(lc) && typeof lc.sha === "string" && typeof lc.ts === "string") metrics.lastCommit = { sha: lc.sha, ts: lc.ts };
  else {
    delete metrics.lastCommit;
    if (lc !== void 0) report?.("metrics.lastCommit", "dropped", kindOf2(lc));
  }
  return {
    name: str2(x2.name),
    locale: str2(x2.locale),
    version: str2(x2.version),
    planHash: str2(x2.planHash),
    tracks: keepAll(arr(x2.tracks), (t) => isObj2(t) && typeof t.id === "string" && typeof t.name === "string", "tracks", report),
    // G-25: a version's target is a date; any other value is dropped (and reported).
    versions: arr(x2.versions).filter(isObj2).map((v, i) => {
      if (v.target === void 0 || typeof v.target === "string" && realDate(v.target)) return v;
      report?.(`versions[${i}].target`, "dropped", kindOf2(v.target));
      const { target: _t, ...rest } = v;
      return rest;
    }),
    phaseOrder: arr(x2.phaseOrder),
    metrics,
    syncedAt: str2(x2.syncedAt),
    ...linksOf(x2.links),
    // Carry 9: x.y.z and nothing after it.
    ...typeof x2.waypointVersion === "string" && /^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(x2.waypointVersion) ? { waypointVersion: x2.waypointVersion } : {}
  };
}
function normalizeTask(t) {
  return { ...t, id: t.id, title: t.title, depends_on: strs(t.depends_on), zones: strs(t.zones), done_when: typeof t.done_when === "string" ? t.done_when : "", track: str2(t.track), phase: str2(t.phase) };
}
function normalizePhase(x2, report) {
  if (!isObj2(x2) || typeof x2.id !== "string") return null;
  const out = {
    ...x2,
    id: x2.id,
    name: str2(x2.name),
    order: typeof x2.order === "number" && Number.isFinite(x2.order) ? x2.order : 0,
    // The plan's own default (plan.ts: committed); any other value would reach a class name in the views.
    plan_status: x2.plan_status === "provisional" ? "provisional" : "committed",
    tasks: keepAll(arr(x2.tasks), (t) => isObj2(t) && typeof t.id === "string" && typeof t.title === "string", "tasks", report).map(normalizeTask)
  };
  if (x2.plan_status !== void 0 && x2.plan_status !== "committed" && x2.plan_status !== "provisional") report?.("plan_status", "coerced", kindOf2(x2.plan_status));
  const goal = typeof x2.goal === "string" ? cleanText(x2.goal, 300) : "";
  if (goal) out.goal = goal;
  else {
    delete out.goal;
    if (x2.goal !== void 0) report?.("goal", "dropped", kindOf2(x2.goal));
  }
  return out;
}
function normalizeState(x2, report) {
  const o = isObj2(x2) ? x2 : {};
  const s = { ...o };
  s.commits = keepAll(arr(o.commits), (c) => isObj2(c) && typeof c.sha === "string" && typeof c.title === "string", "commits", report);
  if (!("commits" in o) || o.commits === void 0) delete s.commits;
  s.blockedBy = Array.isArray(o.blockedBy) ? strs(o.blockedBy) : void 0;
  const reason = typeof o.blockedReason === "string" ? cleanText(o.blockedReason, REASON_MAX) : "";
  if (reason) s.blockedReason = reason;
  else {
    delete s.blockedReason;
    if (o.blockedReason !== void 0) report?.("blockedReason", "dropped", kindOf2(o.blockedReason));
  }
  for (const k2 of ["claimedAt", "startedAt", "doneAt"]) s[k2] = optStr(o[k2]);
  const forge = normalizeForge(o.forge, report);
  if (forge) s.forge = forge;
  else delete s.forge;
  const evidence = normalizeEvidence(o.evidence, report);
  if (evidence) s.evidence = evidence;
  else delete s.evidence;
  const exec = normalizeExec(o.exec, report);
  if (exec) s.exec = exec;
  else delete s.exec;
  return s;
}
var isoOrNull = (v) => typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : null;
function normalizeExec(x2, report) {
  if (x2 === void 0) return void 0;
  const drop = (why) => {
    report?.("exec", "dropped", why);
    return void 0;
  };
  if (!isObj2(x2)) return drop(kindOf2(x2));
  if (typeof x2.runId !== "string") return drop("no runId");
  if (typeof x2.by !== "string") return drop("no by");
  const since = isoOrNull(x2.since), leaseUntil = isoOrNull(x2.leaseUntil);
  if (!since || !leaseUntil) return drop("since or leaseUntil is not a date");
  if (!STAGES.includes(x2.stage)) return drop(`stage ${String(x2.stage).slice(0, 20)}`);
  if (x2.mode !== "subagents" && x2.mode !== "sessions" && x2.mode !== "manual") return drop(`mode ${String(x2.mode).slice(0, 20)}`);
  const e = { runId: x2.runId, mode: x2.mode, by: x2.by, stage: x2.stage, since, leaseUntil };
  if (typeof x2.agent === "string" || x2.agent === null) e.agent = x2.agent;
  if (typeof x2.round === "number" && Number.isInteger(x2.round)) e.round = x2.round;
  return e;
}
var finite = (v) => typeof v === "number" && Number.isFinite(v);
function normalizeForge(x2, report) {
  if (isObj2(x2) && x2.v === 2) {
    const v2 = parseForgeDocV2(x2, report);
    if (v2) return v2;
  }
  return normalizeForgeV1(x2, report);
}
function normalizeForgeV1(x2, report) {
  if (x2 === void 0) return void 0;
  if (!isObj2(x2) || typeof x2.path !== "string" || typeof x2.phase !== "string") {
    report?.("forge", "dropped", isObj2(x2) ? "no path or phase" : kindOf2(x2));
    return void 0;
  }
  const f = { path: x2.path, phase: x2.phase };
  if (typeof x2.agent === "string") f.agent = x2.agent;
  if (Array.isArray(x2.validators)) {
    const vals = [];
    x2.validators.forEach((v, i) => {
      if (typeof v === "string" && v) {
        vals.push({ name: v.slice(0, 80), ok: null });
        report?.(`forge.validators[${i}]`, "coerced", "string");
      } else if (isObj2(v) && typeof v.name === "string" && (typeof v.ok === "boolean" || v.ok === null)) vals.push({ name: v.name, ok: v.ok });
      else report?.(`forge.validators[${i}]`, "dropped", kindOf2(v));
    });
    f.validators = vals;
  }
  if (isObj2(x2.verdict) && typeof x2.verdict.action === "string") f.verdict = { action: x2.verdict.action, score: finite(x2.verdict.score) ? x2.verdict.score : null };
  if (finite(x2.round)) f.round = x2.round;
  if (finite(x2.cap)) f.cap = x2.cap;
  return f;
}
function normalizeSession(x2, report) {
  const o = isObj2(x2) ? x2 : {};
  let runId;
  if (safeId(o.runId)) runId = o.runId;
  else if (o.runId != null) report?.("runId", "dropped", typeof o.runId === "string" ? "not a run id" : kindOf2(o.runId));
  return {
    ...o,
    name: str2(o.name),
    heartbeatAt: typeof o.heartbeatAt === "string" ? o.heartbeatAt : "",
    currentTask: optStr(o.currentTask),
    track: optStr(o.track) ?? null,
    agentName: optStr(o.agentName),
    branch: optStr(o.branch),
    worktree: optStr(o.worktree),
    busyUntil: optStr(o.busyUntil),
    role: o.role === "coordinator" || o.role === "executor" || o.role === "manual" ? o.role : void 0,
    runId,
    leaseUntil: optStr(o.leaseUntil)
  };
}
var stateDoc = (x2) => isObj2(x2) ? normalizeState(x2) : null;
var sessionDoc = (x2) => isObj2(x2) ? normalizeSession(x2) : null;
function normalizeMessage(x2) {
  if (!isObj2(x2)) return null;
  return {
    ts: str2(x2.ts),
    from: str2(x2.from),
    to: str2(x2.to),
    type: str2(x2.type),
    taskId: optStr(x2.taskId),
    text: str2(x2.text),
    status: x2.status === "resolved" ? "resolved" : "open",
    replyTo: optStr(x2.replyTo)
  };
}
var SAFE_ID = /^[A-Za-z0-9_\-.]{1,120}$/;
var safeId = (v) => typeof v === "string" && SAFE_ID.test(v) && v !== "." && v !== "..";
var safeUrl = (u) => typeof u === "string" && (u.startsWith("https://claude.ai/") || /^\/_blob\/[\w-]+$/.test(u)) ? u : void 0;
function normalizeEvidence(x2, report) {
  if (x2 === void 0) return void 0;
  if (!isObj2(x2) || x2.result !== "pass" && x2.result !== "fail" && x2.result !== "blocked") {
    report?.("evidence", "dropped", isObj2(x2) ? `result ${String(x2.result).slice(0, 20)}` : kindOf2(x2));
    return void 0;
  }
  const e = {
    surfaces: strs(x2.surfaces),
    result: x2.result,
    passed: finite(x2.passed) ? x2.passed : 0,
    total: finite(x2.total) ? x2.total : 0,
    shots: arr(x2.shots).flatMap((v, i) => {
      if (!isObj2(v) || typeof v.ok !== "boolean") {
        report?.(`evidence.shots[${i}]`, "dropped", kindOf2(v));
        return [];
      }
      let check;
      if (typeof v.check === "string") check = v.check;
      else if (finite(v.check)) {
        check = String(v.check);
        report?.(`evidence.shots[${i}].check`, "coerced", "number");
      } else {
        report?.(`evidence.shots[${i}]`, "dropped", "no check");
        return [];
      }
      const shot = { surface: str2(v.surface), check, ok: v.ok };
      const url = safeUrl(v.url);
      if (url) shot.url = url;
      if (typeof v.id === "string") shot.id = v.id;
      if (typeof v.expected === "string") shot.expected = v.expected;
      if (typeof v.observed === "string") shot.observed = v.observed;
      if (typeof v.round === "number" && Number.isInteger(v.round) && v.round >= 1 && v.round <= 99) shot.round = v.round;
      return [shot];
    }).slice(0, 30)
  };
  if (typeof x2.local === "string") e.local = x2.local;
  if (x2.pending === true) e.pending = true;
  if (typeof x2.reason === "string") e.reason = x2.reason;
  if (x2.v === 2) e.v = 2;
  if (Array.isArray(x2.unchecked)) e.unchecked = strs(x2.unchecked).map((u) => cleanText(u, 200)).filter(Boolean).slice(0, UNCHECKED_MAX);
  return e;
}

// src/lib/read-docs.ts
var import_node_fs2 = require("node:fs");
var import_node_path2 = __toESM(require("node:path"), 1);
function readDocs(dir, normalize) {
  const docs = {};
  const skipped = [];
  let names;
  try {
    names = (0, import_node_fs2.readdirSync)(dir).filter((f) => f.endsWith(".json")).sort();
  } catch {
    return { docs, skipped };
  }
  for (const f of names) {
    const id = f.slice(0, -5);
    let value;
    try {
      value = JSON.parse((0, import_node_fs2.readFileSync)(import_node_path2.default.join(dir, f), "utf8"));
    } catch {
      skipped.push(f);
      continue;
    }
    const doc = value === null ? null : normalize ? normalize(value) : value;
    if (doc === null || doc === void 0 || id === "__proto__") {
      skipped.push(f);
      continue;
    }
    docs[id] = doc;
  }
  return { docs, skipped };
}

// src/lib/design.ts
var import_yaml2 = __toESM(require_dist(), 1);
var ID = /^[A-Za-z0-9_.-]{1,64}$/;
var DESIGN_STATUSES = ["draft", "approved", "parked"];
function designSchemas() {
  const MetaSchema = external_exports.object({
    title: external_exports.string().min(1),
    project: external_exports.string().regex(ID, "invalid id (allowed: letters, digits, _ . -; max 64)").refine((s) => s !== "." && s !== "..", "invalid id"),
    locale: external_exports.string().min(1).default("en"),
    summary: external_exports.string().min(1),
    pillars: external_exports.array(external_exports.object({ title: external_exports.string().min(1), text: external_exports.string().min(1) })).max(8).default([]),
    start_prompt: external_exports.string().min(1).default("/waypoint:work <track>"),
    status: external_exports.enum(DESIGN_STATUSES).default("draft"),
    artifact: external_exports.string().url().optional(),
    source: external_exports.string().min(1).max(300).optional()
  });
  return { MetaSchema };
}
var designBuilt;
var schemas2 = () => designBuilt ??= designSchemas();
var DesignError = class extends Error {
  constructor(issues) {
    super(`Invalid design:
- ${issues.join("\n- ")}`);
    this.issues = issues;
    this.name = "DesignError";
  }
  issues;
};
var FM = /^---\r?\n(?:([\s\S]*?)\r?\n)?---\r?\n?([\s\S]*)$/;
var BOM = String.fromCharCode(65279);
function frontMatterOf(text) {
  return FM.exec(text.startsWith(BOM) ? text.slice(1) : text);
}
function parseDesign(text) {
  const m = frontMatterOf(text);
  if (!m) throw new DesignError(["missing front matter block (--- ... ---) at the top of design.md"]);
  let raw;
  try {
    raw = (0, import_yaml2.parse)(m[1] ?? "");
  } catch (e) {
    throw new DesignError([`YAML: ${e.message}`]);
  }
  const r2 = schemas2().MetaSchema.safeParse(raw ?? {});
  if (!r2.success) throw new DesignError(r2.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`));
  const body = m[2];
  return { meta: r2.data, body, sections: sectionsOf(body), words: wordCount(body) };
}
function setDesignStatus(text, status) {
  const bom = text.startsWith(BOM) ? BOM : "";
  const rest = bom ? text.slice(1) : text;
  const m = /^(---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/.exec(rest);
  if (!m) throw new DesignError(["missing front matter block (--- ... ---) at the top of design.md"]);
  const eol = m[1].endsWith("\r\n") ? "\r\n" : "\n";
  const lines2 = m[2].split(/\r?\n/);
  const at2 = lines2.findIndex((l3) => /^status\s*:/.test(l3));
  if (at2 >= 0) lines2[at2] = `status: ${status}`;
  else lines2.push(`status: ${status}`);
  return `${bom}${m[1]}${lines2.join(eol)}${m[3]}${rest.slice(m[0].length)}`;
}
var SLUG_MAX = 80;
var cutSlug = (slug, max) => slug.slice(0, max).replace(/-+$/, "");
function designBody(text) {
  const t = text.startsWith(BOM) ? text.slice(1) : text;
  const m = FM.exec(t);
  return m ? m[2] : t;
}
function designStatus(text) {
  const m = FM.exec(text.startsWith(BOM) ? text.slice(1) : text);
  if (!m) return null;
  try {
    const raw = (0, import_yaml2.parse)(m[1] ?? "");
    const status = raw && typeof raw === "object" ? raw.status : void 0;
    return typeof status === "string" ? status : null;
  } catch {
    return null;
  }
}
function slugify(heading) {
  const slug = heading.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return cutSlug(slug, SLUG_MAX) || "section";
}
var nthSlug = (base, n) => `${cutSlug(base, SLUG_MAX - `-${n}`.length)}-${n}`;
function sectionsOf(body) {
  return parseSections(body).sections;
}
var LINE_BREAK = new RegExp(`[\\r${String.fromCharCode(8232, 8233)}]`);
function headingOf(line3) {
  const level = line3.startsWith("###") ? 3 : line3.startsWith("##") ? 2 : 0;
  if (!level || !/\s/.test(line3.charAt(level))) return null;
  let text = line3.slice(level).trim();
  let end = text.length;
  while (end > 0 && text.charCodeAt(end - 1) === 35) end--;
  if (end > 0 && end < text.length && /\s/.test(text.charAt(end - 1))) text = text.slice(0, end).trimEnd();
  return text && !LINE_BREAK.test(text) ? { level, text } : null;
}
function parseSections(body) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  let fence = null;
  let cur = null;
  const lines2 = [];
  const introLines = [];
  const flush = () => {
    if (cur) {
      cur.text = lines2.join("\n").trim();
      out.push(cur);
    }
    lines2.length = 0;
  };
  for (const line3 of body.split(/\r?\n/)) {
    const isHeading = fence ? null : headingOf(line3);
    if (fence) {
      const close = /^\s*(`{3,}|~{3,})\s*$/.exec(line3);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null;
    } else {
      const open = /^\s*(`{3,}|~{3,})/.exec(line3);
      if (open) fence = open[1];
    }
    if (isHeading) {
      flush();
      const base = slugify(isHeading.text);
      let slug = base;
      for (let n = 2; seen.has(slug); n++) slug = nthSlug(base, n);
      seen.add(slug);
      cur = { level: isHeading.level, heading: isHeading.text, slug, text: "" };
    } else if (cur) {
      lines2.push(line3);
    } else {
      introLines.push(line3);
    }
  }
  flush();
  return { intro: introLines.join("\n").trim(), sections: out };
}
function wordCount(body) {
  return body.replace(/[#>*_`~\-|[\]()]/g, " ").split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}
var norm2 = (s) => s.replace(/\s+/g, " ").trim();
function changedSections(prev, next) {
  const p = parseSections(prev);
  const n = parseSections(next);
  const before = new Map([["_intro", norm2(p.intro)], ...p.sections.map((s) => [s.slug, norm2(s.text)])]);
  const after = [["_intro", norm2(n.intro)], ...n.sections.map((s) => [s.slug, norm2(s.text)])];
  const changed = [];
  for (const [slug, text] of after) {
    const old = before.get(slug);
    if (slug === "_intro" ? (old ?? "") !== text : old !== text) changed.push(slug);
  }
  const kept = new Set(n.sections.map((s) => s.slug));
  return { changed, removed: p.sections.map((s) => s.slug).filter((s) => !kept.has(s)) };
}

// src/lib/design-import.ts
var import_yaml3 = __toESM(require_dist(), 1);
var SpecImportError = class extends Error {
};
var SUMMARY_MAX2 = 400;
var BOM2 = String.fromCharCode(65279);
var PURPOSE = /prop[oó]sito|purpose|overview|resumen|summary|objetivo|goal/i;
function linesOf(text) {
  const out = [];
  let fence = null;
  for (const piece of text.split(/(?<=\n)/)) {
    const t = piece.replace(/\r?\n$/, "");
    if (fence) {
      out.push({ text: t, fenced: true });
      const close = /^\s*(`{3,}|~{3,})\s*$/.exec(t);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null;
      continue;
    }
    const open = /^\s*(`{3,}|~{3,})/.exec(t);
    if (open) fence = open[1];
    out.push({ text: t, fenced: !!open });
  }
  return out;
}
function specTitle(h1) {
  return h1.replace(/\s*(?:[—–-]|:)\s*(?:diseño|design)\s*$/i, "").trim() || h1.trim();
}
function firstParagraph(lines2) {
  const para = [];
  for (const l3 of lines2) {
    const t = l3.text.trim();
    const plain = !l3.fenced && !!t && !/^(#{1,6}\s|[-*+]\s|\d+[.)]\s|\||>|<!--)/.test(t) && !/^(-{3,}|\*{3,}|_{3,})$/.test(t);
    if (plain) {
      para.push(t);
      continue;
    }
    if (para.length) break;
  }
  if (!para.length) return null;
  return para.join(" ").replace(/\s+/g, " ").trim().slice(0, SUMMARY_MAX2).trimEnd();
}
function importSpec(text, opts) {
  const src = text.startsWith(BOM2) ? text.slice(1) : text;
  const lines2 = linesOf(src);
  const h1 = lines2.findIndex((l3) => !l3.fenced && /^#\s+\S/.test(l3.text));
  if (h1 < 0) throw new SpecImportError('the spec has no "# " title');
  const after = lines2.slice(h1 + 1);
  if (!after.some((l3) => !l3.fenced && /^##\s+\S/.test(l3.text))) throw new SpecImportError('the spec has no "## " section');
  const title = specTitle(lines2[h1].text.replace(/^#\s+/, "").replace(/\s+#*\s*$/, ""));
  let summary = null;
  for (let i = 0; i < after.length && summary === null; i++) {
    const m = after[i].fenced ? null : /^#{2,3}\s+(.+)$/.exec(after[i].text);
    if (!m || !PURPOSE.test(m[1])) continue;
    const next = after.findIndex((x2, j2) => j2 > i && !x2.fenced && /^#{2,3}\s/.test(x2.text));
    summary = firstParagraph(after.slice(i + 1, next < 0 ? after.length : next));
  }
  summary ??= firstParagraph(after) ?? title;
  const meta = { title, project: opts.project, locale: opts.locale, summary, pillars: [], start_prompt: "/waypoint:work <track>", status: "draft", source: opts.source };
  const body = src.split(/(?<=\n)/).slice(h1 + 1).join("").replace(/^(?:[ \t]*\r?\n)+/, "");
  return `---
${(0, import_yaml3.stringify)(meta, { lineWidth: 0 })}---

${body}`;
}

// src/lib/critique.ts
var ROUND_MAX = 999999;
var CRITIQUE_FILE = /^r([1-9]\d{0,5})\.json$/;
var LEGACY_CRITIQUE_FILE = /^critique-r([1-9]\d{0,5})\.json$/;
var CATEGORIES = ["scope", "done_criteria", "risk", "contradiction", "gap"];
var SEVERITIES = ["critical", "major", "minor"];
var VERDICTS = ["ready", "changes"];
function critiqueSchemas() {
  const ProposalSchema = external_exports.object({
    n: external_exports.number().int().positive(),
    category: external_exports.enum(CATEGORIES),
    severity: external_exports.enum(SEVERITIES),
    section: external_exports.string().min(1),
    problem: external_exports.string().min(1),
    change: external_exports.string().min(1)
  });
  const CritiqueSchema = external_exports.object({
    round: external_exports.number().int().positive(),
    version: external_exports.number().int().positive(),
    scope: external_exports.enum(["full", "changed"]),
    // K3-04: optional, so the critiques written before it still read; parseCritique fills it in.
    verdict: external_exports.enum(VERDICTS).optional(),
    proposals: external_exports.array(ProposalSchema)
  });
  return { ProposalSchema, CritiqueSchema };
}
var critiqueBuilt;
var schemas3 = () => critiqueBuilt ??= critiqueSchemas();
var CritiqueError = class extends Error {
  constructor(issues) {
    super(`Invalid critique:
- ${issues.join("\n- ")}`);
    this.issues = issues;
    this.name = "CritiqueError";
  }
  issues;
};
function verdictOf(c) {
  return c.proposals.some((p) => p.severity !== "minor") ? "changes" : "ready";
}
function parseCritique(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new CritiqueError(["critique is not valid JSON"]);
  }
  const r2 = schemas3().CritiqueSchema.safeParse(raw);
  const issues = r2.success ? [] : r2.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
  const props = raw?.proposals;
  if (Array.isArray(props)) {
    const ns = props.map((p) => p?.n);
    if (!ns.every((n, i) => n === i + 1)) issues.push(`proposals must be numbered 1..${props.length} without gaps`);
  }
  if (issues.length || !r2.success) throw new CritiqueError(issues);
  const expected = verdictOf(r2.data);
  if (r2.data.verdict !== void 0 && r2.data.verdict !== expected) {
    const serious = r2.data.proposals.find((p) => p.severity !== "minor");
    throw new CritiqueError([serious ? `verdict is "${r2.data.verdict}" but proposal ${serious.n} is ${serious.severity}` : `verdict is "${r2.data.verdict}" but no proposal is critical or major`]);
  }
  return { ...r2.data, verdict: r2.data.verdict ?? expected };
}
function budgetFor(round, verify = false) {
  const n = Number.isFinite(round) && round >= 1 ? Math.floor(round) : 1;
  if (verify || n >= 3) return { max: 3, severities: ["critical"] };
  if (n === 2) return { max: 6, severities: ["critical", "major"] };
  return { max: 12, severities: ["critical", "major", "minor"] };
}
function budgetIssues(c, b) {
  const out = [];
  if (c.proposals.length > b.max) out.push(`${c.proposals.length} proposals, but this round allows at most ${b.max}`);
  for (const p of c.proposals) {
    if (!b.severities.includes(p.severity)) out.push(`proposal ${p.n} is ${p.severity}, but this round allows only ${b.severities.join(" and ")}`);
  }
  return out;
}
function scopeFor(o) {
  if (o.verify || o.round >= 3) return "changed";
  if (o.round <= 1 && !o.reopened) return "full";
  return o.total === 0 || o.changed * 2 > o.total ? "full" : "changed";
}
function selectProposals(c, spec) {
  if (spec.trim().toLowerCase() === "all") return c.proposals;
  const parts = spec.split(",").map((s) => s.trim());
  if (parts.some((p) => !/^[1-9]\d*$/.test(p))) throw new CritiqueError([`invalid selection "${spec}" (use "all" or numbers like 1,3,5)`]);
  const wanted = new Set(parts.map(Number));
  const missing = [...wanted].filter((n) => !c.proposals.some((p) => p.n === n));
  if (missing.length) throw new CritiqueError([`no such proposals: ${missing.join(", ")}`]);
  return c.proposals.filter((p) => wanted.has(p.n));
}
var LABELS = {
  en: {
    cat: { scope: "Scope", done_criteria: "Done criteria", risk: "Risk", contradiction: "Contradiction", gap: "Gap" },
    sev: { critical: "critical", major: "major", minor: "minor" },
    intro: "Intro",
    quote: (s) => `"${s}"`
  },
  es: {
    cat: { scope: "Alcance", done_criteria: "Criterio de hecho", risk: "Riesgo", contradiction: "Contradicci\xF3n", gap: "Hueco" },
    sev: { critical: "cr\xEDtica", major: "mayor", minor: "menor" },
    intro: "Introducci\xF3n",
    quote: (s) => `\xAB${s}\xBB`
  }
};
function formatProposals(c, locale = "en", headings = {}) {
  const key = locale.toLowerCase().split(/[-_]/)[0];
  const l3 = Object.hasOwn(LABELS, key) ? LABELS[key] : LABELS.en;
  const flat = (s) => s.replace(/\s*[\r\n]+\s*/g, " ");
  const name = (slug) => slug === "_intro" ? l3.intro : Object.hasOwn(headings, slug) ? flat(headings[slug]) : slug;
  return c.proposals.map((p) => `${p.n}. [${l3.cat[p.category]} \xB7 ${l3.sev[p.severity]}] ${l3.quote(name(p.section))} \u2014 ${flat(p.problem)} \u2192 ${flat(p.change)}`).join("\n");
}

// src/lib/history.ts
var ENTRY_KINDS = ["draft", "round", "apply", "rewrite", "interview", "approve", "amend", "reopen"];
function historySchemas() {
  const EntrySchema = external_exports.object({
    version: external_exports.number(),
    date: external_exports.string(),
    note: external_exports.string(),
    words: external_exports.number(),
    round: external_exports.number()
  });
  return { EntrySchema };
}
var historyBuilt;
var schemas4 = () => historyBuilt ??= historySchemas();
function normalizeApplied(x2) {
  if (!x2 || typeof x2 !== "object" || Array.isArray(x2)) return null;
  const out = {};
  for (const [k2, v] of Object.entries(x2)) {
    if (!/^[1-9]\d{0,5}$/.test(k2) || !Array.isArray(v)) continue;
    const ns = v.filter((n) => Number.isSafeInteger(n) && n > 0);
    if (ns.length) out[Number(k2)] = [...new Set(ns)].sort((a, b) => a - b);
  }
  return Object.keys(out).length ? out : null;
}
function normalizeResolved(x2) {
  if (!Array.isArray(x2)) return null;
  const positive = (v) => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
  const seen = /* @__PURE__ */ new Map();
  for (const item of x2) {
    if (!item || typeof item !== "object") continue;
    const { round, n } = item;
    if (positive(round) && round <= ROUND_MAX && positive(n)) seen.set(`${round}:${n}`, { round, n });
  }
  const out = [...seen.values()].sort((a, b) => a.round - b.round || a.n - b.n);
  return out.length ? out : null;
}
var AppliedError = class extends Error {
};
function parseAppliedItems(items, round, name = "applied") {
  const option = `--${name}`;
  if (!items.length) throw new AppliedError(`${option} needs at least one item (r<R>:<numbers> or <numbers>)`);
  const out = {};
  for (const item of items) {
    const m = /^(?:r([1-9]\d*):)?([1-9]\d*(?:,[1-9]\d*)*)$/.exec(item);
    if (!m) throw new AppliedError(`${option} item ${item.slice(0, 40)} is not r<R>:<numbers> nor <numbers>`);
    if (!m[1] && round === null) throw new AppliedError(`${option} item ${item} has no round: add --round <R> or write it r<R>:${item}`);
    const r2 = m[1] ? Number(m[1]) : round;
    if (round !== null && r2 > round) throw new AppliedError(`${option} round ${r2} is after --round ${round}`);
    out[r2] = [.../* @__PURE__ */ new Set([...out[r2] ?? [], ...m[2].split(",").map(Number)])].sort((a, b) => a - b);
  }
  return out;
}
function roundList(r2) {
  return Object.entries(r2).flatMap(([k2, ns]) => ns.map((n) => ({ round: Number(k2), n }))).sort((a, b) => a.round - b.round || a.n - b.n);
}
function listVersions(files) {
  const set = /* @__PURE__ */ new Set();
  for (const f of files) {
    const m = /^v(\d+)\.md$/.exec(f);
    if (m) set.add(Number(m[1]));
  }
  return [...set].sort((a, b) => a - b);
}
function nextVersion(files) {
  const v = listVersions(files);
  return v.length ? v[v.length - 1] + 1 : 1;
}
function parseChangelog(text) {
  if (!text || !text.trim()) return [];
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("changelog.json is not valid JSON");
  }
  if (!Array.isArray(raw)) throw new Error("changelog.json must be a JSON array");
  return raw.map((e, i) => {
    const r2 = schemas4().EntrySchema.safeParse(e);
    if (!r2.success) {
      const why = r2.error.issues.map((x2) => `${x2.path.join(".") || "(root)"}: ${x2.message}`).join("; ");
      throw new Error(`changelog.json entry ${i} is invalid: ${why}`);
    }
    const entry = e;
    const applied = normalizeApplied(entry.applied);
    const resolved = normalizeResolved(entry.resolved);
    const kind = typeof entry.kind === "string" && ENTRY_KINDS.includes(entry.kind) ? entry.kind : null;
    return {
      ...r2.data,
      ...applied ? { applied } : {},
      ...entry.rewrite === true ? { rewrite: true } : {},
      ...resolved ? { resolved } : {},
      ...kind ? { kind } : {}
    };
  });
}
function appendChangelog(list, e) {
  const last = list[list.length - 1];
  if (last && e.version <= last.version) throw new Error(`changelog already has version ${last.version}; cannot append version ${e.version}`);
  return [...list, e];
}
var KIND_NOTES = [
  // Only a note that starts with it, as an approval: "ronda 2: aplicadas 1 - evita reabrir el diseño" is an apply, and
  // read as a reopen it would restart the budget (carry 6).
  ["reopen", /^\s*(?:reopen(?:ed|ing)?|reabiert[oa]|reabrir)\b/i],
  ["amend", /\b(?:amend(?:ed|ment)?|enmienda|enmendad[oa])\b/i],
  // Only a note that starts with it: "round 2: applied 1 — approve the rollback" is an apply.
  ["approve", /^\s*(?:approved?|aprobad[oa])\b/i]
];
function entryRound(e) {
  const r2 = e?.round;
  return typeof r2 === "number" && Number.isSafeInteger(r2) && r2 >= 0 && r2 <= ROUND_MAX ? r2 : 0;
}
function entryKind(e) {
  if (e.kind) return e.kind;
  if (e.rewrite) return "rewrite";
  if (e.applied) return "apply";
  for (const [kind, re2] of KIND_NOTES) if (re2.test(e.note)) return kind;
  return null;
}

// src/lib/design-gate.ts
var REASON_MAX2 = LIMITS.reason;
var DISMISSED_MAX_CHARS = 1024 * 1024;
var GATE_LIST_MAX = 40;
var GATE_TEXT_MAX = 300;
var line2 = (s) => Array.from(clean(s, Number.MAX_SAFE_INTEGER)).slice(0, GATE_TEXT_MAX).join("");
var APPLIED_NOTE = /\b(?:round|ronda)\s+(\d+)\s*:\s*(?:applied|aplicad[ao]s?)\s+(\d+(?:\s*(?:,|y|and)\s*\d+)*)/gi;
var REWRITE_NOTE = /^\s*(?:round|ronda)\s+(\d+)\s*:\s*(?:rewrite|reescritura|reescrit[ao])/i;
var legacy = (e) => e.applied === void 0 && e.rewrite === void 0;
function appliedIn(changelog, round) {
  const out = /* @__PURE__ */ new Set();
  for (const e of changelog) {
    if (e.applied) {
      for (const n of e.applied[round] ?? []) out.add(n);
      continue;
    }
    if (!legacy(e)) continue;
    for (const m of e.note.matchAll(APPLIED_NOTE)) {
      if (Number(m[1]) !== round) continue;
      for (const n of m[2].split(/\s*(?:,|y|and)\s*/i)) if (/^\d+$/.test(n)) out.add(Number(n));
    }
  }
  return out;
}
function rewroteRound(changelog, round) {
  return changelog.some((e) => {
    if (e.round !== round) return false;
    if (e.rewrite === true) return true;
    if (!legacy(e)) return false;
    const m = REWRITE_NOTE.exec(e.note);
    return !!m && Number(m[1]) === round;
  });
}
function appliedVersion(changelog, round, n) {
  for (const e of changelog) if (appliedIn([e], round).has(n)) return e.version;
  return null;
}
function resolvedIn(changelog, round) {
  return new Set(changelog.flatMap((e) => (e.resolved ?? []).filter((x2) => x2.round === round).map((x2) => x2.n)));
}
function parseDismissed(text) {
  if (text && text.length > DISMISSED_MAX_CHARS) return {};
  let raw;
  try {
    raw = JSON.parse(text ?? "");
  } catch {
    return {};
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  for (const [k2, v] of Object.entries(raw)) {
    if (!/^[1-9]\d{0,5}$/.test(k2) || !Array.isArray(v)) continue;
    const byN = /* @__PURE__ */ new Map();
    for (const x2 of v) {
      const item = x2 && typeof x2 === "object" ? x2 : null;
      const n = item ? item.n : x2;
      if (typeof n !== "number" || !Number.isSafeInteger(n) || n <= 0) continue;
      const reason = item && typeof item.reason === "string" ? clean(item.reason, REASON_MAX2) : "";
      byN.set(n, reason ? { n, reason } : byN.get(n) ?? { n });
    }
    if (byN.size) out[Number(k2)] = [...byN.values()].sort((a, b) => a.n - b.n);
  }
  return out;
}
function mergeDismissed(d, round, ns, reason) {
  const why = reason ? clean(reason, REASON_MAX2) : "";
  const byN = new Map((d[round] ?? []).map((x2) => [x2.n, x2]));
  for (const n of ns) {
    const had = byN.get(n);
    byN.set(n, had?.reason ? had : why ? { n, reason: why } : had ?? { n });
  }
  return { ...d, [round]: [...byN.values()].sort((a, b) => a.n - b.n) };
}
function unionDismissed(...lists) {
  const out = {};
  for (const d of lists) {
    for (const [k2, items] of Object.entries(d)) {
      const byN = new Map((out[Number(k2)] ?? []).map((x2) => [x2.n, x2]));
      for (const x2 of items) byN.set(x2.n, x2.reason ? x2 : byN.get(x2.n) ?? x2);
      if (byN.size) out[Number(k2)] = [...byN.values()].sort((a, b) => a.n - b.n);
    }
  }
  return out;
}
var oneByRound = (critiques) => {
  const seen = /* @__PURE__ */ new Set();
  return critiques.filter((c) => !seen.has(c.round) && !!seen.add(c.round));
};
function pendingProposals(changelog, critiques, dismissed = {}) {
  const out = [];
  for (const { round, critique } of oneByRound(critiques).sort((a, b) => a.round - b.round)) {
    if (!critique || rewroteRound(changelog, round)) continue;
    const decided = /* @__PURE__ */ new Set([...appliedIn(changelog, round), ...resolvedIn(changelog, round), ...(dismissed[round] ?? []).map((x2) => x2.n)]);
    for (const p of critique.proposals) {
      if (!decided.has(p.n)) out.push({ round, n: p.n, severity: p.severity, section: p.section, problem: p.problem });
    }
  }
  return out;
}
function handEditOf(changelog, texts = {}) {
  const snapshot = texts.history?.[changelog[changelog.length - 1]?.version ?? 0];
  if (texts.current === void 0 || snapshot === void 0) return false;
  const edit = changedSections(designBody(snapshot), designBody(texts.current));
  return edit.changed.length > 0 || edit.removed.length > 0;
}
function needsVerifyOf(changelog, critiques, texts = {}) {
  const top = [...critiques].filter((c) => c.critique !== null).sort((a, b) => b.round - a.round)[0]?.critique;
  if (!top) return false;
  const version = changelog[changelog.length - 1]?.version ?? 0;
  if (handEditOf(changelog, texts)) return true;
  if (top.version >= version) return false;
  const before = texts.history?.[top.version];
  const after = texts.current ?? texts.history?.[version];
  if (before === void 0 || after === void 0) return changelog.some((e) => e.version > top.version && entryKind(e) !== "approve");
  const d = changedSections(designBody(before), designBody(after));
  return d.changed.length > 0 || d.removed.length > 0;
}
function designGate(changelog, given, dismissed = {}, texts = {}) {
  const critiques = oneByRound(given);
  const version = changelog[changelog.length - 1]?.version ?? 0;
  const latestRound = critiques.length ? Math.max(...critiques.map((c) => c.round)) : null;
  const latest = latestRound === null ? null : critiques.find((c) => c.round === latestRound)?.critique ?? null;
  const pending = pendingProposals(changelog, critiques, dismissed);
  const criticalPending = pending.filter((p) => p.severity === "critical").map((p) => ({ round: p.round, n: p.n }));
  const majorPending = pending.filter((p) => p.severity === "major").map((p) => ({ round: p.round, n: p.n }));
  const needsVerify = needsVerifyOf(changelog, critiques, texts);
  const count = (s) => pending.filter((p) => p.severity === s).length;
  const latestCritiqueVersion = latest?.version ?? null;
  const valid = [...critiques].sort((a, b) => a.round - b.round).flatMap((c) => c.critique ? [{ round: c.round, proposals: c.critique.proposals }] : []);
  const gone = [];
  const solved = [];
  const done = [];
  for (const { round, proposals } of valid) {
    const applied = appliedIn(changelog, round);
    const resolved = resolvedIn(changelog, round);
    const set = new Map((dismissed[round] ?? []).map((x2) => [x2.n, x2]));
    for (const p of proposals) {
      const section = () => line2(p.section);
      if (applied.has(p.n)) done.push({ round, n: p.n, section: section(), change: line2(p.change) });
      if (resolved.has(p.n)) solved.push({ round, n: p.n, section: section(), problem: line2(p.problem) });
      const x2 = set.get(p.n);
      if (x2) gone.push({ round, n: p.n, section: section(), problem: line2(p.problem), ...x2.reason ? { reason: x2.reason } : {} });
    }
  }
  const newest2 = (list) => list.slice(-GATE_LIST_MAX);
  const more = (list) => Math.max(0, list.length - GATE_LIST_MAX);
  return {
    version,
    rounds: valid.length,
    latestRound,
    latestCritiqueVersion,
    criticalPending,
    majorPending,
    invalid: critiques.filter((c) => c.critique === null).map((c) => c.round).sort((a, b) => a - b),
    needsVerify,
    handEdit: handEditOf(changelog, texts),
    canAutoApprove: latest !== null && criticalPending.length === 0 && majorPending.length === 0 && !needsVerify && latestCritiqueVersion !== null && latestCritiqueVersion <= version,
    // Final review M4: what each pending proposal says goes to the critic and to the approve line, so it is one clean
    // line like the other lists; the list and its counts stay whole, so an old pending proposal is never hidden.
    pending: pending.map((p) => ({ ...p, section: line2(p.section), problem: line2(p.problem) })),
    pendingCounts: { critical: count("critical"), major: count("major"), minor: count("minor") },
    dismissed: newest2(gone),
    resolved: newest2(solved),
    applied: newest2(done),
    ...more(gone) ? { dismissedMore: more(gone) } : {},
    ...more(solved) ? { resolvedMore: more(solved) } : {},
    ...more(done) ? { appliedMore: more(done) } : {}
  };
}

// node_modules/marked/lib/marked.esm.js
function I() {
  return { async: false, breaks: false, extensions: null, gfm: true, hooks: null, pedantic: false, renderer: null, silent: false, tokenizer: null, walkTokens: null };
}
var P = I();
function W(l3) {
  P = l3;
}
var A = { exec: () => null };
function C(l3) {
  let e = [];
  return (t) => {
    let n = Math.max(0, Math.min(3, t - 1)), s = e[n];
    return s || (s = l3(n), e[n] = s), s;
  };
}
function h(l3, e = "") {
  let t = typeof l3 == "string" ? l3 : l3.source, n = { replace: (s, r2) => {
    let o = typeof r2 == "string" ? r2 : r2.source;
    return o = o.replace(x.caret, "$1"), t = t.replace(s, o), n;
  }, getRegex: () => new RegExp(t, e) };
  return n;
}
var _e = ((l3 = "") => {
  try {
    return !!new RegExp("(?<=1)(?<!1)" + l3);
  } catch {
    return false;
  }
})();
var x = { codeRemoveIndent: /^(?: {0,3}\t| {1,4})/gm, outputLinkReplace: /\\([\[\]])/g, indentCodeCompensation: /^(\s+)(?:```)/, beginningSpace: /^\s+/, endingHash: /#$/, startingSpaceChar: /^ /, endingSpaceChar: / $/, endingSpaceTabChar: /[ \t]$/, nonSpaceChar: /[^ ]/, newLineCharGlobal: /\n/g, tabCharGlobal: /\t/g, leadingSpaceTab: /^[ \t]+/, multipleSpaceGlobal: /\s+/g, blankLine: /^[ \t]*$/, doubleBlankLine: /\n[ \t]*\n[ \t]*$/, blockquoteStart: /^ {0,3}>/, blockquoteSetextReplace: /\n {0,3}((?:=+|-+) *)(?=\n|$)/g, blockquoteSetextReplace2: /^ {0,3}>[ \t]?/gm, listReplaceNesting: /^ {1,4}(?=( {4})*[^ ])/g, listIsTask: /^\[[ xX]\] +\S/, listReplaceTask: /^\[[ xX]\] +/, listTaskCheckbox: /\[[ xX]\]/, anyLine: /\n.*\n/, hrefBrackets: /^<(.*)>$/, tableDelimiter: /[:|]/, tableAlignChars: /^\||\| *$/g, tableRowBlankLine: /\n[ \t]*$/, tableAlignRight: /^ *-+: *$/, tableAlignCenter: /^ *:-+: *$/, tableAlignLeft: /^ *:-+ *$/, startATag: /^<a /i, endATag: /^<\/a>/i, startPreScriptTag: /^<(pre|code|kbd|script)(\s|>)/i, endPreScriptTag: /^<\/(pre|code|kbd|script)(\s|>)/i, startAngleBracket: /^</, endAngleBracket: />$/, pedanticHrefTitle: /^([^'"]*[^\s])\s+(['"])(.*)\2/, unicodeAlphaNumeric: /[\p{L}\p{N}]/u, numericCharacterReference: /&#(?:(\d{1,7})|[Xx]([A-Fa-f0-9]{1,6}));/g, escapeTest: /[&<>"']/, escapeReplace: /[&<>"']/g, escapeTestNoEncode: /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/, escapeReplaceNoEncode: /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g, caret: /(^|[^\[])\^/g, percentDecode: /%25/g, findPipe: /\|/g, splitPipe: / \|/, slashPipe: /\\\|/g, carriageReturn: /\r\n|\r/g, spaceLine: /^ +$/gm, notSpaceStart: /^\S*/, endingNewline: /\n$/, listItemRegex: (l3) => new RegExp(`^( {0,3}${l3})((?:[	 ][^\\n]*)?(?:\\n|$))`), nextBulletRegex: C((l3) => new RegExp(`^ {0,${l3}}(?:[*+-]|\\d{1,9}[.)])((?:[ 	][^\\n]*)?(?:\\n|$))`)), hrRegex: C((l3) => new RegExp(`^ {0,${l3}}((?:-[ 	]*){3,}|(?:_[ 	]*){3,}|(?:\\*[ 	]*){3,})(?:\\n+|$)`)), fencesBeginRegex: C((l3) => new RegExp(`^ {0,${l3}}(?:\`\`\`|~~~)`)), headingBeginRegex: C((l3) => new RegExp(`^ {0,${l3}}#`)), htmlBeginRegex: C((l3) => new RegExp(`^ {0,${l3}}(?:</?(?:${N})(?: +|$|/?>)|<(?:script|pre|style|textarea|!--))`, "i")), blockquoteBeginRegex: C((l3) => new RegExp(`^ {0,${l3}}>`)) };
var $e = /^(?:[ \t]*(?:\n|$))+/;
var Le = /^((?: {4}| {0,3}\t)[^\n]+(?:\n(?:[ \t]*(?:\n|$))*)?)+/;
var ze = /^ {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)(?:\n|$)(?:|([\s\S]*?)(?:\n|$))(?: {0,3}\1[~`]* *(?=\n|$)|$)/;
var G = /^ {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/;
var Ae = /^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/;
var J = / {0,3}(?:[*+-]|\d{1,9}[.)])/;
var he = /^(?!bull |blockCode|fences|blockquote|heading|html|table)((?:.|\n(?!\s*?\n|bull |fences|blockquote|heading|hr|html|table))+?)\n {0,3}(=+|-+) *(?:\n+|$)/;
var de = h(he).replace(/bull/g, J).replace(/blockCode/g, /(?: {4}| {0,3}\t)/).replace(/fences/g, / {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g, / {0,3}>/).replace(/heading/g, / {0,3}#{1,6}(?:\s|$)/).replace(/hr/g, / {0,3}(?:(?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/).replace(/html/g, / {0,3}<[^\n>]+>\n/).replace(/\|table/g, "").getRegex();
var Ee = h(he).replace(/bull/g, J).replace(/blockCode/g, /(?: {4}| {0,3}\t)/).replace(/fences/g, / {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g, / {0,3}>/).replace(/heading/g, / {0,3}#{1,6}(?:\s|$)/).replace(/hr/g, / {0,3}(?:(?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/).replace(/html/g, / {0,3}<[^\n>]+>\n/).replace(/table/g, / {0,3}\|?(?:[:\- ]*\|)+[\:\- ]*\n/).getRegex();
var V = /^([^\n]+(?:\n(?!hr|heading|lheading|blockquote|fences|list|html|table|[ \t]+\n)[^\n]+)*)/;
var Me = /^[^\n]+/;
var Y = /(?!\s*\])(?:\\[\s\S]|[^\[\]\\])+/;
var Ie = h(/^ {0,3}\[(label)\]: *(?:\n[ \t]*)?([^<\s][^\s]*|<.*?>)(?:(?: +(?:\n[ \t]*)?| *\n[ \t]*)(title))? *(?:\n+|$)/).replace("label", Y).replace("title", /(?:"(?:\\"?|[^"\\])*"|'[^'\n]*(?:\n[^'\n]+)*\n?'|\([^()]*\))/).getRegex();
var Ce = h(/^(bull)([ \t][^\n]*?)?(?:\n|$)/).replace(/bull/g, J).getRegex();
var N = "address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul";
var ee = /<!--(?:-?>|[\s\S]*?(?:-->|$))/;
var Be = h("^ {0,3}(?:<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n*|$)|comment[^\\n]*(\\n+|$)|<\\?[\\s\\S]*?(?:\\?>[^\\n]*\\n*|$)|<![A-Z][\\s\\S]*?(?:>[^\\n]*\\n*|$)|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>[^\\n]*\\n*|$)|</?(tag)(?: +|\\n|/?>)[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|<(?!script|pre|style|textarea)([a-z][a-z0-9-]*)(?:attribute)*? */?>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|</(?!script|pre|style|textarea)[a-z][a-z0-9-]*\\s*>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$))", "i").replace("comment", ee).replace("tag", N).replace("attribute", / +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?/).getRegex();
var ke = (l3) => h(V).replace("hr", G).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("|lheading", "").replace("|table", "").replace("blockquote", " {0,3}>").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)").replace("list", l3).replace("html", "</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag", N).getRegex();
var De = ke(/ {0,3}(?:[*+-]|1[.)])[ \t]+[^ \t\n]/);
var qe = ke(/ {0,3}(?:[*+-]|\d{1,9}[.)])(?:[ \t]|\n|$)/);
var ve = h(/^( {0,3}> ?(paragraph|[^\n]*)(?:\n|$))+/).replace("paragraph", qe).getRegex();
var te = { blockquote: ve, code: Le, def: Ie, fences: ze, heading: Ae, hr: G, html: Be, lheading: de, list: Ce, newline: $e, paragraph: De, table: A, text: Me };
var ue = h("^ *([^\\n ].*)\\n {0,3}((?:\\| *)?:?-+:? *(?:\\| *:?-+:? *)*(?:\\| *)?)(?:\\n((?:(?! *\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\n|$))*)\\n*|$)").replace("hr", G).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("blockquote", " {0,3}>").replace("code", "(?: {4}| {0,3}	)[^\\n]").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)").replace("list", " {0,3}(?:[*+-]|1[.)])[ \\t]").replace("html", "</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag", N).getRegex();
var Ze = { ...te, lheading: Ee, table: ue, paragraph: h(V).replace("hr", G).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("|lheading", "").replace("table", ue).replace("blockquote", " {0,3}>").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)").replace("list", " {0,3}(?:[*+-]|1[.)])[ \\t]+[^ \\t\\n]").replace("html", "</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag", N).getRegex() };
var He = { ...te, html: h(`^ *(?:comment *(?:\\n|\\s*$)|<(tag)[\\s\\S]+?</\\1> *(?:\\n{2,}|\\s*$)|<tag(?:"[^"]*"|'[^']*'|\\s[^'"/>\\s]*)*?/?> *(?:\\n{2,}|\\s*$))`).replace("comment", ee).replace(/tag/g, "(?!(?:a|em|strong|small|s|cite|q|dfn|abbr|data|time|code|var|samp|kbd|sub|sup|i|b|u|mark|ruby|rt|rp|bdi|bdo|span|br|wbr|ins|del|img)\\b)\\w+(?!:|[^\\w\\s@]*@)\\b").getRegex(), def: /^ *\[([^\]]+)\]: *<?([^\s>]+)>?(?: +(["(][^\n]+[")]))? *(?:\n+|$)/, heading: /^(#{1,6})(.*)(?:\n+|$)/, fences: A, lheading: /^(.+?)\n {0,3}(=+|-+) *(?:\n+|$)/, paragraph: h(V).replace("hr", G).replace("heading", ` *#{1,6} *[^
]`).replace("lheading", de).replace("|table", "").replace("blockquote", " {0,3}>").replace("|fences", "").replace("|list", "").replace("|html", "").replace("|tag", "").getRegex() };
var Ge = /^\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/;
var Ne = /^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/;
var ge = /^( {2,}|\\)\n(?!\s*$)[ \t]*/;
var Qe = /^(`+|[^`])(?:(?= {2,}\n)|[\s\S]*?(?:(?=[\\<!\[`*_]|\b_|$)|[^ ](?= {2,}\n)))/;
var $ = /[\p{P}\p{S}]/u;
var B = /[\s\p{P}\p{S}]/u;
var Q = /[^\s\p{P}\p{S}]/u;
var je = h(/^((?![*_])punctSpace)/, "u").replace(/punctSpace/g, B).getRegex();
var Fe = /[\p{Pi}\p{Ps}"']/u;
var fe = /(?!~)[\p{P}\p{S}]/u;
var Ue = /(?!~)[\s\p{P}\p{S}]/u;
var Ke = /(?:[^\s\p{P}\p{S}]|~)/u;
var We = h(/link|precode-code|html/, "g").replace("link", /\[(?:[^\[\]`]|(?<a>`+)[^`]+\k<a>(?!`))*?\]\((?:\\[\s\S]|[^\\\(\)]|\((?:\\[\s\S]|[^\\\(\)])*\))*\)/).replace("precode-", _e ? "(?<!`)()" : "(^^|[^`])").replace("code", /(?<b>`+)[^`]+\k<b>(?!`)/).replace("html", /<(?! )[^<>]*?>/).getRegex();
var me = /^(?:\*+(?:((?!\*)punct)|([^\s*]))?)|^_+(?:((?!_)punct)|([^\s_]))?/;
var Xe = h(me, "u").replace(/punct/g, $).getRegex();
var Je = h(me, "u").replace(/punct/g, fe).getRegex();
var Ve = /^(?:\*+(?:((?!\*)(?!openQuote)punct)|([^\s*]))?)|^_+(?:((?!_)(?!openQuote)punct)|([^\s_]))?/;
var Ye = h(Ve, "u").replace(/openQuote/g, Fe).replace(/punct/g, $).getRegex();
var xe = "^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)punct(\\*+)(?=[\\s]|$)|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)|(?!\\*)punctSpace(\\*+)(?=notPunctSpace)|[\\s](\\*+)(?!\\*)(?=punct)|(?!\\*)punct(\\*+)(?!\\*)(?=punct)|notPunctSpace(\\*+)(?=notPunctSpace)";
var et = h(xe, "gu").replace(/notPunctSpace/g, Q).replace(/punctSpace/g, B).replace(/punct/g, $).getRegex();
var tt = h(xe, "gu").replace(/notPunctSpace/g, Ke).replace(/punctSpace/g, Ue).replace(/punct/g, fe).getRegex();
var nt = "^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)punct(\\*+)(?=[\\s]|$)|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)|(?!\\*)[\\s](\\*+)(?=notPunctSpace)|[\\s](\\*+)(?!\\*)(?=punct)|(?!\\*)punct(\\*+)(?!\\*)(?=punct)|(?:(?!\\*)punct|notPunctSpace)(\\*+)(?!\\*)(?=notPunctSpace)";
var rt = h(nt, "gu").replace(/notPunctSpace/g, Q).replace(/punctSpace/g, B).replace(/punct/g, $).getRegex();
var st = h("^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)punctSpace(_+)(?=notPunctSpace)|[\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)", "gu").replace(/notPunctSpace/g, Q).replace(/punctSpace/g, B).replace(/punct/g, $).getRegex();
var it = "^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)[\\s](_+)(?=notPunctSpace)|[\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)|(?:(?!_)punct|notPunctSpace)(_+)(?!_)(?=notPunctSpace)";
var ot = h(it, "gu").replace(/notPunctSpace/g, Q).replace(/punctSpace/g, B).replace(/punct/g, $).getRegex();
var at = h(/^~~?(?:((?!~)punct)|[^\s~])/, "u").replace(/punct/g, $).getRegex();
var lt = "^[^~]+(?=[^~])|(?!~)punct(~~?)(?=[\\s]|$)|notPunctSpace(~~?)(?!~)(?=punctSpace|$)|(?!~)punctSpace(~~?)(?=notPunctSpace)|[\\s](~~?)(?!~)(?=punct)|(?!~)punct(~~?)(?!~)(?=punct)|notPunctSpace(~~?)(?=notPunctSpace)";
var ut = h(lt, "gu").replace(/notPunctSpace/g, Q).replace(/punctSpace/g, B).replace(/punct/g, $).getRegex();
var pt = h(/\\(punct)/, "gu").replace(/punct/g, $).getRegex();
var ct = h(/^<(scheme:[^\s\x00-\x1f<>]*|email)>/).replace("scheme", /[a-zA-Z][a-zA-Z0-9+.-]{1,31}/).replace("email", /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])/).getRegex();
var ht = h(ee).replace("(?:-->|$)", "-->").getRegex();
var dt = h("^comment|^</[a-zA-Z][a-zA-Z0-9-]*\\s*>|^<[a-zA-Z][a-zA-Z0-9-]*(?:attribute)*?\\s*/?>|^<\\?[\\s\\S]*?\\?>|^<![a-zA-Z]+\\s[\\s\\S]*?>|^<!\\[CDATA\\[[\\s\\S]*?\\]\\]>").replace("comment", ht).replace("attribute", /\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?/).getRegex();
var be = /\[(?:\\[\s\S]|[^\[\]\\])*\]/;
var U = h(/(?:\[(?:brackets|\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\])|[^\[\]\\`])*?/).replace("brackets", be).getRegex();
var kt = h(/^!?\[(label)\]\([ \t\n]*(href)(?:(?:[ \t]+(?:\n[ \t]*)?|\n[ \t]*)(title))?[ \t\n]*\)/).replace("label", U).replace("href", /<(?:\\.|[^\n<>\\])+>|[^ \t\n\x00-\x1f]+|(?=\))/).replace("title", /"(?:\\"?|[^"\\])*"|'(?:\\'?|[^'\\])*'|\((?:\\\)?|[^)\\])*\)/).getRegex();
var gt = h(/^!?\[(label)\]\[(ref)\]/).replace("label", U).replace("ref", Y).getRegex();
var ft = h(/^!?\[(ref)\](?:\[\])?/).replace("ref", Y).getRegex();
var pe = /(?!\s*\])(?:\\[\s\S]|[^\[\]\\]){1,999}/;
var mt = h(/(?:[^\[\]\\`]*(?:\[(?:brackets|\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\]))){0,999}?[^\[\]\\`]*?/).replace("brackets", be).getRegex();
var xt = h("reflink|nolink(?!\\()", "g").replace("reflink", h(/^!?\[(label)\]\[(ref)\]/).replace("label", mt).replace("ref", pe).getRegex()).replace("nolink", h(/^!?\[(ref)\](?:\[\])?/).replace("ref", pe).getRegex()).getRegex();
var ce = /[hH][tT][tT][pP][sS]?|[fF][tT][pP]/;
var bt = /[A-Za-z0-9._+-]+@[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])/;
var Rt = h(/(?:mailto:email|xmpp:email(?:\/[A-Za-z0-9@.]+)?)/).replace(/email/g, bt).getRegex();
var ne = { _backpedal: A, anyPunctuation: pt, autolink: ct, blockSkip: We, br: ge, code: Ne, del: A, delLDelim: A, delRDelim: A, emStrongLDelim: Xe, emStrongRDelimAst: et, emStrongRDelimUnd: st, escape: Ge, link: kt, nolink: ft, punctuation: je, reflink: gt, reflinkSearch: xt, tag: dt, text: Qe, url: A };
var Tt = { ...ne, emStrongLDelim: Ye, emStrongRDelimAst: rt, emStrongRDelimUnd: ot, link: h(/^!?\[(label)\]\((.*?)\)/).replace("label", U).getRegex(), reflink: h(/^!?\[(label)\]\s*\[([^\]]*)\]/).replace("label", U).getRegex() };
var X = { ...ne, emStrongRDelimAst: tt, emStrongLDelim: Je, delLDelim: at, delRDelim: ut, url: h(/^emailProtocol|^((?:protocol):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|^email/).replace("emailProtocol", Rt).replace("protocol", ce).replace("email", /[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])/).getRegex(), _backpedal: /(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/, del: /^(~~?)(?=[^\s~])((?:\\[\s\S]|[^\\])*?(?:\\[\s\S]|[^\s~\\]))\1(?=[^~]|$)/, text: h(/^(?:[^a-zA-Z0-9](?=emailProtocol)|(`+|~+|[^`~])(?:(?=[`~])|(?= {2,}\n)|(?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)|[\s\S]*?(?:(?=[\\<!\[`*~_]|\b_|protocol:\/\/|www\.|$)|[^ ](?= {2,}\n)|[^a-zA-Z0-9](?=emailProtocol)|[^a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-](?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@))))/).replace("protocol", ce).replace(/emailProtocol/g, /(?:mailto|xmpp):/).getRegex() };
var Ot = { ...X, br: h(ge).replace("{2,}", "*").getRegex(), text: h(X.text).replace("\\b_", "\\b_| {2,}\\n").replace(/\{2,\}/g, "*").getRegex() };
var j = { normal: te, gfm: Ze, pedantic: He };
var D = { normal: ne, gfm: X, breaks: Ot, pedantic: Tt };
var wt = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
var Re = (l3) => wt[l3];
function O(l3, e) {
  if (e) {
    if (x.escapeTest.test(l3)) return l3.replace(x.escapeReplace, Re);
  } else if (x.escapeTestNoEncode.test(l3)) return l3.replace(x.escapeReplaceNoEncode, Re);
  return l3;
}
function Te(l3) {
  return l3.replace(x.numericCharacterReference, (e, t, n) => {
    let s = t === void 0 ? Number.parseInt(n, 16) : Number.parseInt(t, 10);
    return s === 0 || s > 1114111 || s >= 55296 && s <= 57343 ? "\uFFFD" : String.fromCodePoint(s);
  });
}
function re(l3) {
  try {
    l3 = encodeURI(l3).replace(x.percentDecode, "%");
  } catch {
    return null;
  }
  return l3;
}
function se(l3, e) {
  let t = l3.replace(x.findPipe, (r2, o, i) => {
    let u = false, a = o;
    for (; --a >= 0 && i[a] === "\\"; ) u = !u;
    return u ? "|" : " |";
  }), n = t.split(x.splitPipe), s = 0;
  if (n[0].trim() || n.shift(), n.length > 0 && !n.at(-1)?.trim() && n.pop(), e) if (n.length > e) n.splice(e);
  else for (; n.length < e; ) n.push("");
  for (; s < n.length; s++) n[s] = n[s].trim().replace(x.slashPipe, "|");
  return n;
}
function L(l3, e, t) {
  let n = l3.length;
  if (n === 0) return "";
  let s = 0;
  for (; s < n; ) {
    let r2 = l3.charAt(n - s - 1);
    if (r2 === e && !t) s++;
    else if (r2 !== e && t) s++;
    else break;
  }
  return l3.slice(0, n - s);
}
function ie(l3) {
  let e = l3.split(`
`), t = e.length - 1;
  for (; t >= 0 && x.blankLine.test(e[t]); ) t--;
  return e.length - t <= 2 ? l3 : e.slice(0, t + 1).join(`
`);
}
function q(l3) {
  return l3.trim().toLowerCase().toUpperCase().toLowerCase();
}
function oe(l3, e) {
  if (l3.indexOf(e[0]) === -1 && l3.indexOf(e[1]) === -1) return -1;
  let t = 0;
  for (let n = 0; n < l3.length; n++) if (l3[n] === "\\") n++;
  else if (l3[n] === e[0]) t++;
  else if (l3[n] === e[1] && (t--, t < 0)) return n;
  return t > 0 ? -2 : -1;
}
function ae(l3, e = 0) {
  let t = e, n = "";
  for (let s of l3) if (s === "	") {
    let r2 = 4 - t % 4;
    n += " ".repeat(r2), t += r2;
  } else n += s, t++;
  return n;
}
function Oe(l3, e, t, n, s) {
  let r2 = e.href, o = e.title || null, i = l3[1].replace(s.other.outputLinkReplace, "$1"), u = l3[0].charAt(0) === "!";
  n.state.inLink = true;
  let a = n.state.linkEmitted, p = n.state.inRawBlock;
  n.state.linkEmitted = false;
  let c = n.inlineTokens(i), d = n.state.linkEmitted;
  if (n.state.linkEmitted = a, n.state.inLink = false, !u) {
    if (d) {
      n.state.inRawBlock = p;
      return;
    }
    n.state.linkEmitted = true;
  }
  return { type: u ? "image" : "link", raw: t, href: r2, title: o, text: i, tokens: c };
}
function Pt(l3, e, t) {
  let n = l3.match(t.other.indentCodeCompensation);
  if (n === null) return e;
  let s = n[1];
  return e.split(`
`).map((r2) => {
    let o = r2.match(t.other.beginningSpace);
    if (o === null) return r2;
    let [i] = o;
    return r2.slice(Math.min(i.length, s.length));
  }).join(`
`);
}
function we(l3, e, t, n) {
  if (!e.includes("<")) return false;
  for (let s = 0; s < e.length; s++) {
    if (e[s] === "\\") {
      s++;
      continue;
    }
    if (e[s] === "`") {
      let i = n.inline.code.exec(e.slice(s));
      if (i) {
        s += i[0].length - 1;
        continue;
      }
    }
    if (e[s] !== "<") continue;
    let r2 = l3.slice(t + s), o = n.inline.tag.exec(r2) || n.inline.autolink.exec(r2);
    if (o) {
      if (o[0].length > e.length - s) return true;
      s += o[0].length - 1;
    }
  }
  return false;
}
var y = class {
  options;
  rules;
  lexer;
  constructor(e) {
    this.options = e || P;
  }
  space(e) {
    let t = this.rules.block.newline.exec(e);
    if (t && t[0].length > 0) return { type: "space", raw: t[0] };
  }
  code(e) {
    let t = this.rules.block.code.exec(e);
    if (t) {
      let n = this.options.pedantic ? t[0] : ie(t[0]), s = n.replace(this.rules.other.codeRemoveIndent, "");
      return { type: "code", raw: n, codeBlockStyle: "indented", text: s };
    }
  }
  fences(e) {
    let t = this.rules.block.fences.exec(e);
    if (t) {
      let n = t[0], s = Pt(n, t[3] || "", this.rules);
      return { type: "code", raw: n, lang: t[2] ? t[2].trim().replace(this.rules.inline.anyPunctuation, "$1") : t[2], text: s };
    }
  }
  heading(e) {
    let t = this.rules.block.heading.exec(e);
    if (t) {
      let n = t[2].trim();
      if (this.rules.other.endingHash.test(n)) {
        let s = L(n, "#");
        (this.options.pedantic || !s || this.rules.other.endingSpaceTabChar.test(s)) && (n = s.trim());
      }
      return { type: "heading", raw: L(t[0], `
`), depth: t[1].length, text: n, tokens: this.lexer.inline(n) };
    }
  }
  hr(e) {
    let t = this.rules.block.hr.exec(e);
    if (t) return { type: "hr", raw: L(t[0], `
`) };
  }
  blockquote(e) {
    let t = this.rules.block.blockquote.exec(e);
    if (t) {
      let n = L(t[0], `
`).split(`
`), s = "", r2 = "", o = [];
      for (; n.length > 0; ) {
        let i = false, u = [], a;
        for (a = 0; a < n.length; a++) if (this.rules.other.blockquoteStart.test(n[a])) u.push(n[a]), i = true;
        else if (!i) u.push(n[a]);
        else break;
        n = n.slice(a);
        let p = u.join(`
`), c = p.replace(this.rules.other.blockquoteSetextReplace, `
    $1`).replace(this.rules.other.blockquoteSetextReplace2, "");
        s = s ? `${s}
${p}` : p, r2 = r2 ? `${r2}
${c}` : c;
        let d = this.lexer.state.top;
        if (this.lexer.state.top = true, this.lexer.blockTokens(c, o, true), this.lexer.state.top = d, n.length === 0) break;
        let m = o.at(-1);
        if (m?.type === "code") break;
        if (m?.type === "blockquote") {
          let b = m, g = n.join(`
`), w = b.raw + `
` + g.replace(this.rules.other.blockquoteSetextReplace2, ""), f = this.blockquote(w);
          o[o.length - 1] = f;
          let M = w.substring(f.raw.length).replace(/^\n/, ""), v = M ? M.split(`
`).length : 0, Z = v ? n.slice(0, -v) : n;
          Z.length > 0 && (s = `${s}
${Z.join(`
`)}`), r2 = r2.substring(0, r2.length - b.text.length) + f.text;
          break;
        } else if (m?.type === "list") {
          let b = m, g = b.raw + `
` + n.join(`
`), w = this.list(g);
          o[o.length - 1] = w, s = s.substring(0, s.length - m.raw.length) + w.raw, r2 = r2.substring(0, r2.length - b.raw.length) + w.raw, n = g.substring(o.at(-1).raw.length).split(`
`);
          continue;
        }
      }
      return { type: "blockquote", raw: s, tokens: o, text: r2 };
    }
  }
  list(e) {
    let t = this.rules.block.list.exec(e);
    if (t) {
      let n = t[1].trim(), s = n.length > 1, r2 = { type: "list", raw: "", ordered: s, start: s ? +n.slice(0, -1) : "", loose: false, items: [] };
      n = s ? `\\d{1,9}\\${n.slice(-1)}` : `\\${n}`, this.options.pedantic && (n = s ? n : "[*+-]");
      let o = this.rules.other.listItemRegex(n), i = false;
      for (; e; ) {
        let a = false, p = "", c = "";
        if (!(t = o.exec(e)) || this.rules.block.hr.test(e)) break;
        p = t[0], e = e.substring(p.length);
        let d = t[2].split(`
`, 1)[0], m = t[1].length, b = this.options.pedantic ? ae(d, m) : d.replace(this.rules.other.leadingSpaceTab, (M) => ae(M, m)), g = e.split(`
`, 1)[0], w = !b.trim(), f = 0;
        if (this.options.pedantic ? (f = 2, c = b.trimStart()) : w ? f = m + 1 : (f = b.search(this.rules.other.nonSpaceChar), f = f > 4 ? 1 : f, c = b.slice(f), f += m), w && this.rules.other.blankLine.test(g) && (p += g + `
`, e = e.substring(g.length + 1), a = true), !a) {
          let M = this.rules.other.nextBulletRegex(f), v = this.rules.other.hrRegex(f), Z = this.rules.other.fencesBeginRegex(f), le = this.rules.other.headingBeginRegex(f), Pe = this.rules.other.htmlBeginRegex(f), ye = this.rules.other.blockquoteBeginRegex(f);
          for (; e; ) {
            let K = e.split(`
`, 1)[0], H2;
            if (g = K, this.options.pedantic ? (g = g.replace(this.rules.other.listReplaceNesting, "  "), H2 = g) : H2 = g.replace(this.rules.other.leadingSpaceTab, (Se) => Se.replace(this.rules.other.tabCharGlobal, "    ")), Z.test(g) || le.test(g) || Pe.test(g) || ye.test(g) || M.test(g) || v.test(g)) break;
            if (H2.search(this.rules.other.nonSpaceChar) >= f || !g.trim()) c += `
` + H2.slice(f);
            else {
              if (w || b.replace(this.rules.other.tabCharGlobal, "    ").search(this.rules.other.nonSpaceChar) >= 4 || Z.test(b) || le.test(b) || v.test(b)) break;
              c += `
` + g;
            }
            w = !g.trim(), p += K + `
`, e = e.substring(K.length + 1), b = H2.slice(f);
          }
        }
        r2.loose || (i ? r2.loose = true : this.rules.other.doubleBlankLine.test(p) && (i = true)), r2.items.push({ type: "list_item", raw: p, task: !!this.options.gfm && this.rules.other.listIsTask.test(c), loose: false, text: c, tokens: [] }), r2.raw += p;
      }
      let u = r2.items.at(-1);
      if (u) u.raw = u.raw.trimEnd(), u.text = u.text.trimEnd();
      else return;
      r2.raw = r2.raw.trimEnd();
      for (let a of r2.items) if (this.lexer.state.top = false, a.tokens = this.lexer.blockTokens(a.text, []), !r2.loose) {
        let p = a.tokens.filter((d) => d.type === "space"), c = p.length > 0 && p.some((d) => this.rules.other.anyLine.test(d.raw));
        r2.loose = c;
      }
      for (let a of r2.items) {
        let p = a.tokens[0];
        if (a.task && (p?.type === "text" || p?.type === "paragraph")) {
          a.text = a.text.replace(this.rules.other.listReplaceTask, ""), p.raw = p.raw.replace(this.rules.other.listReplaceTask, ""), p.text = p.text.replace(this.rules.other.listReplaceTask, "");
          for (let d = this.lexer.inlineQueue.length - 1; d >= 0; d--) if (this.rules.other.listIsTask.test(this.lexer.inlineQueue[d].src)) {
            this.lexer.inlineQueue[d].src = this.lexer.inlineQueue[d].src.replace(this.rules.other.listReplaceTask, "");
            break;
          }
          let c = this.rules.other.listTaskCheckbox.exec(a.raw);
          if (c) {
            let d = { type: "checkbox", raw: c[0] + " ", checked: c[0] !== "[ ]" };
            a.checked = d.checked, r2.loose ? a.tokens[0] && ["paragraph", "text"].includes(a.tokens[0].type) && "tokens" in a.tokens[0] && a.tokens[0].tokens ? (a.tokens[0].raw = d.raw + a.tokens[0].raw, a.tokens[0].text = d.raw + a.tokens[0].text, a.tokens[0].tokens.unshift(d)) : a.tokens.unshift({ type: "paragraph", raw: d.raw, text: d.raw, tokens: [d] }) : a.tokens.unshift(d);
          }
        } else a.task && (a.task = false);
      }
      if (r2.loose) for (let a of r2.items) {
        a.loose = true;
        for (let p of a.tokens) p.type === "text" && (p.type = "paragraph");
      }
      return r2;
    }
  }
  html(e) {
    let t = this.rules.block.html.exec(e);
    if (t) {
      let n = ie(t[0]);
      return { type: "html", block: true, raw: n, pre: t[1] === "pre" || t[1] === "script" || t[1] === "style", text: n };
    }
  }
  def(e) {
    let t = this.rules.block.def.exec(e);
    if (t) {
      if (!this.rules.other.startAngleBracket.test(t[2]) && oe(t[2], "()") !== -1) return;
      let n = q(t[1]).replace(this.rules.other.multipleSpaceGlobal, " "), s = t[2] ? t[2].replace(this.rules.other.hrefBrackets, "$1").replace(this.rules.inline.anyPunctuation, "$1") : "", r2 = t[3] ? t[3].substring(1, t[3].length - 1).replace(this.rules.inline.anyPunctuation, "$1") : t[3];
      return { type: "def", tag: n, raw: L(t[0], `
`), href: s, title: r2 };
    }
  }
  table(e) {
    let t = this.rules.block.table.exec(e);
    if (!t || !this.rules.other.tableDelimiter.test(t[2])) return;
    let n = se(t[1]), s = t[2].replace(this.rules.other.tableAlignChars, "").split("|"), r2 = t[3]?.trim() ? t[3].replace(this.rules.other.tableRowBlankLine, "").split(`
`) : [], o = { type: "table", raw: L(t[0], `
`), header: [], align: [], rows: [] };
    if (n.length === s.length) {
      for (let i of s) this.rules.other.tableAlignRight.test(i) ? o.align.push("right") : this.rules.other.tableAlignCenter.test(i) ? o.align.push("center") : this.rules.other.tableAlignLeft.test(i) ? o.align.push("left") : o.align.push(null);
      for (let i = 0; i < n.length; i++) o.header.push({ text: n[i], tokens: this.lexer.inline(n[i]), header: true, align: o.align[i] });
      for (let i of r2) o.rows.push(se(i, o.header.length).map((u, a) => ({ text: u, tokens: this.lexer.inline(u), header: false, align: o.align[a] })));
      return o;
    }
  }
  lheading(e) {
    let t = this.rules.block.lheading.exec(e);
    if (t) {
      let n = t[1].trim();
      return { type: "heading", raw: L(t[0], `
`), depth: t[2].charAt(0) === "=" ? 1 : 2, text: n, tokens: this.lexer.inline(n) };
    }
  }
  paragraph(e) {
    let t = this.rules.block.paragraph.exec(e);
    if (t) {
      let n = t[1].charAt(t[1].length - 1) === `
` ? t[1].slice(0, -1) : t[1];
      return { type: "paragraph", raw: t[0], text: n, tokens: this.lexer.inline(n) };
    }
  }
  text(e) {
    let t = this.rules.block.text.exec(e);
    if (t) return { type: "text", raw: t[0], text: t[0], tokens: this.lexer.inline(t[0]) };
  }
  escape(e) {
    let t = this.rules.inline.escape.exec(e);
    if (t) return { type: "escape", raw: t[0], text: t[1] };
  }
  tag(e) {
    let t = this.rules.inline.tag.exec(e);
    if (t) return !this.lexer.state.inLink && this.rules.other.startATag.test(t[0]) ? this.lexer.state.inLink = true : this.lexer.state.inLink && this.rules.other.endATag.test(t[0]) && (this.lexer.state.inLink = false), !this.lexer.state.inRawBlock && this.rules.other.startPreScriptTag.test(t[0]) ? this.lexer.state.inRawBlock = true : this.lexer.state.inRawBlock && this.rules.other.endPreScriptTag.test(t[0]) && (this.lexer.state.inRawBlock = false), { type: "html", raw: t[0], inLink: this.lexer.state.inLink, inRawBlock: this.lexer.state.inRawBlock, block: false, text: t[0] };
  }
  link(e) {
    if (this.lexer.state.linkParenPossible === false) return;
    let t = this.rules.inline.link.exec(e);
    if (t) {
      let n = t[0].charAt(0) === "!" ? 2 : 1;
      if (!this.options.pedantic && we(e, t[1], n, this.rules)) return;
      let s = t[2].trim();
      if (!this.options.pedantic && this.rules.other.startAngleBracket.test(s)) {
        if (!this.rules.other.endAngleBracket.test(s)) return;
        let i = L(s.slice(0, -1), "\\");
        if ((s.length - i.length) % 2 === 0) return;
      } else {
        let i = oe(t[2], "()");
        if (i === -2) return;
        if (i > -1) {
          let a = (t[0].indexOf("!") === 0 ? 5 : 4) + t[1].length + i;
          t[2] = t[2].substring(0, i), t[0] = t[0].substring(0, a).trim(), t[3] = "";
        }
      }
      let r2 = t[2], o = "";
      if (this.options.pedantic) {
        let i = this.rules.other.pedanticHrefTitle.exec(r2);
        i && (r2 = i[1], o = i[3]);
      } else o = t[3] ? t[3].slice(1, -1) : "";
      return r2 = r2.trim(), this.rules.other.startAngleBracket.test(r2) && (this.options.pedantic && !this.rules.other.endAngleBracket.test(s) ? r2 = r2.slice(1) : r2 = r2.slice(1, -1)), Oe(t, { href: r2 && r2.replace(this.rules.inline.anyPunctuation, "$1"), title: o && o.replace(this.rules.inline.anyPunctuation, "$1") }, t[0], this.lexer, this.rules);
    }
  }
  reflink(e, t) {
    let n;
    if ((n = this.rules.inline.reflink.exec(e)) || (n = this.rules.inline.nolink.exec(e))) {
      let s = n[0].charAt(0) === "!" ? 2 : 1;
      if (!this.options.pedantic && we(e, n[1], s, this.rules)) return;
      let r2 = (n[2] || n[1]).replace(this.rules.other.multipleSpaceGlobal, " "), o = t[q(r2)];
      if (!o) {
        let i = n[0].charAt(0);
        return { type: "text", raw: i, text: i };
      }
      return Oe(n, o, n[0], this.lexer, this.rules);
    }
  }
  emStrong(e, t, n = "") {
    let s = this.rules.inline.emStrongLDelim.exec(e);
    if (!s || !s[1] && !s[2] && !s[3] && !s[4] || s[4] && n.match(this.rules.other.unicodeAlphaNumeric)) return;
    if (!(s[1] || s[3] || "") || !n || this.rules.inline.punctuation.exec(n)) {
      let o = [...s[0]].length - 1, i, u, a = o, p = 0, c = s[0][0], d = n === c, m = c === "*" ? this.rules.inline.emStrongRDelimAst : this.rules.inline.emStrongRDelimUnd;
      for (m.lastIndex = 0, t = t.slice(-1 * e.length + o); (s = m.exec(t)) !== null; ) {
        if (i = s[1] || s[2] || s[3] || s[4] || s[5] || s[6], !i) continue;
        if (u = [...i].length, s[3] || s[4]) {
          a += u;
          continue;
        } else if (s[5] || s[6]) {
          if (o % 3 && !((o + u) % 3)) {
            p += u;
            continue;
          }
          if (d) break;
        }
        if (a -= u, a > 0) continue;
        u = Math.min(u, u + a + p);
        let b = [...s[0]][0].length, g = e.slice(0, o + s.index + b + u);
        if (Math.min(o, u) % 2) {
          let f = g.slice(1, -1);
          return { type: "em", raw: g, text: f, tokens: this.lexer.inlineTokens(f) };
        }
        let w = g.slice(2, -2);
        return { type: "strong", raw: g, text: w, tokens: this.lexer.inlineTokens(w) };
      }
    }
  }
  codespan(e) {
    let t = this.rules.inline.code.exec(e);
    if (t) {
      let n = t[2].replace(this.rules.other.newLineCharGlobal, " "), s = this.rules.other.nonSpaceChar.test(n), r2 = this.rules.other.startingSpaceChar.test(n) && this.rules.other.endingSpaceChar.test(n);
      return s && r2 && (n = n.substring(1, n.length - 1)), { type: "codespan", raw: t[0], text: n };
    }
  }
  br(e) {
    let t = this.rules.inline.br.exec(e);
    if (t) return { type: "br", raw: t[0] };
  }
  del(e, t, n = "") {
    let s = this.rules.inline.delLDelim.exec(e);
    if (!s) return;
    if (!(s[1] || "") || !n || this.rules.inline.punctuation.exec(n)) {
      let o = [...s[0]].length - 1, i, u, a = o, p = this.rules.inline.delRDelim;
      for (p.lastIndex = 0, t = t.slice(-1 * e.length + o); (s = p.exec(t)) !== null; ) {
        if (i = s[1] || s[2] || s[3] || s[4] || s[5] || s[6], !i || (u = [...i].length, u !== o)) continue;
        if (s[3] || s[4]) {
          a += u;
          continue;
        }
        if (a -= u, a > 0) continue;
        u = Math.min(u, u + a);
        let c = [...s[0]][0].length, d = e.slice(0, o + s.index + c + u), m = d.slice(o, -o);
        return { type: "del", raw: d, text: m, tokens: this.lexer.inlineTokens(m) };
      }
    }
  }
  autolink(e) {
    let t = this.rules.inline.autolink.exec(e);
    if (t) {
      let n, s;
      return t[2] === "@" ? (n = t[1], s = "mailto:" + n) : (n = t[1], s = n), { type: "link", raw: t[0], text: n, href: s, autolink: true, tokens: [{ type: "text", raw: n, text: n }] };
    }
  }
  url(e) {
    let t;
    if (t = this.rules.inline.url.exec(e)) {
      let n, s;
      if (t[2] === "@") n = t[0], s = "mailto:" + n;
      else {
        let r2;
        do
          r2 = t[0], t[0] = this.rules.inline._backpedal.exec(t[0])?.[0] ?? "";
        while (r2 !== t[0]);
        n = t[0], t[1] === "www." ? s = "http://" + t[0] : s = t[0];
      }
      return { type: "link", raw: t[0], text: n, href: s, autolink: true, tokens: [{ type: "text", raw: n, text: n }] };
    }
  }
  inlineText(e) {
    let t = this.rules.inline.text.exec(e);
    if (t) {
      let n = this.lexer.state.inRawBlock;
      return { type: "text", raw: t[0], text: n ? t[0] : Te(t[0]), escaped: n };
    }
  }
};
var R = class l {
  tokens;
  options;
  state;
  inlineQueue;
  tokenizer;
  constructor(e) {
    this.tokens = [], this.tokens.links = /* @__PURE__ */ Object.create(null), this.options = e || P, this.options.tokenizer = this.options.tokenizer || new y(), this.tokenizer = this.options.tokenizer, this.tokenizer.options = this.options, this.tokenizer.lexer = this, this.inlineQueue = [], this.state = { inLink: false, inRawBlock: false, linkEmitted: false, linkParenPossible: true, top: true };
    let t = { other: x, block: j.normal, inline: D.normal };
    this.options.pedantic ? (t.block = j.pedantic, t.inline = D.pedantic) : this.options.gfm && (t.block = j.gfm, this.options.breaks ? t.inline = D.breaks : t.inline = D.gfm), this.tokenizer.rules = t;
  }
  static get rules() {
    return { block: j, inline: D };
  }
  static lex(e, t) {
    return new l(t).lex(e);
  }
  static lexInline(e, t) {
    return new l(t).inlineTokens(e);
  }
  lex(e) {
    e = e.replace(x.carriageReturn, `
`), this.blockTokens(e, this.tokens);
    for (let t = 0; t < this.inlineQueue.length; t++) {
      let n = this.inlineQueue[t];
      this.inlineTokens(n.src, n.tokens);
    }
    return this.inlineQueue = [], this.tokens;
  }
  blockTokens(e, t = [], n = false) {
    this.tokenizer.lexer = this, this.options.pedantic && (e = e.replace(x.tabCharGlobal, "    ").replace(x.spaceLine, ""));
    let s = 1 / 0;
    for (; e; ) {
      if (e.length < s) s = e.length;
      else {
        this.infiniteLoopError(e.charCodeAt(0));
        break;
      }
      let r2;
      if (this.options.extensions?.block?.some((i) => (r2 = i.call({ lexer: this }, e, t)) ? (e = e.substring(r2.raw.length), t.push(r2), true) : false)) continue;
      if (r2 = this.tokenizer.space(e)) {
        e = e.substring(r2.raw.length);
        let i = t.at(-1);
        r2.raw.length === 1 && i !== void 0 ? i.raw += `
` : t.push(r2);
        continue;
      }
      if (r2 = this.tokenizer.code(e)) {
        e = e.substring(r2.raw.length);
        let i = t.at(-1);
        i?.type === "paragraph" || i?.type === "text" ? (i.raw += (i.raw.endsWith(`
`) ? "" : `
`) + r2.raw, i.text += `
` + r2.text, this.inlineQueue.at(-1).src = i.text) : t.push(r2);
        continue;
      }
      if (r2 = this.tokenizer.fences(e)) {
        e = e.substring(r2.raw.length), t.push(r2);
        continue;
      }
      if (r2 = this.tokenizer.heading(e)) {
        e = e.substring(r2.raw.length), t.push(r2);
        continue;
      }
      if (r2 = this.tokenizer.hr(e)) {
        e = e.substring(r2.raw.length), t.push(r2);
        continue;
      }
      if (r2 = this.tokenizer.blockquote(e)) {
        e = e.substring(r2.raw.length), t.push(r2);
        continue;
      }
      if (r2 = this.tokenizer.list(e)) {
        e = e.substring(r2.raw.length), t.push(r2);
        continue;
      }
      if (r2 = this.tokenizer.html(e)) {
        e = e.substring(r2.raw.length), t.push(r2);
        continue;
      }
      if (r2 = this.tokenizer.def(e)) {
        e = e.substring(r2.raw.length);
        let i = t.at(-1);
        i?.type === "paragraph" || i?.type === "text" ? (i.raw += (i.raw.endsWith(`
`) ? "" : `
`) + r2.raw, i.text += `
` + r2.raw, this.inlineQueue.at(-1).src = i.text) : this.tokens.links[r2.tag] || (this.tokens.links[r2.tag] = { href: r2.href, title: r2.title }, t.push(r2));
        continue;
      }
      if (r2 = this.tokenizer.table(e)) {
        e = e.substring(r2.raw.length), t.push(r2);
        continue;
      }
      if (r2 = this.tokenizer.lheading(e)) {
        e = e.substring(r2.raw.length), t.push(r2);
        continue;
      }
      let o = e;
      if (this.options.extensions?.startBlock) {
        let i = 1 / 0, u = e.slice(1), a;
        this.options.extensions.startBlock.forEach((p) => {
          a = p.call({ lexer: this }, u), typeof a == "number" && a >= 0 && (i = Math.min(i, a));
        }), i < 1 / 0 && i >= 0 && (o = e.substring(0, i + 1));
      }
      if (this.state.top && (r2 = this.tokenizer.paragraph(o))) {
        let i = t.at(-1);
        n && i?.type === "paragraph" ? (i.raw += (i.raw.endsWith(`
`) ? "" : `
`) + r2.raw, i.text += `
` + r2.text, this.inlineQueue.pop(), this.inlineQueue.at(-1).src = i.text) : t.push(r2), n = o.length !== e.length, e = e.substring(r2.raw.length);
        continue;
      }
      if (r2 = this.tokenizer.text(e)) {
        e = e.substring(r2.raw.length);
        let i = t.at(-1);
        i?.type === "text" ? (i.raw += (i.raw.endsWith(`
`) ? "" : `
`) + r2.raw, i.text += `
` + r2.text, this.inlineQueue.pop(), this.inlineQueue.at(-1).src = i.text) : t.push(r2);
        continue;
      }
      if (e) {
        this.infiniteLoopError(e.charCodeAt(0));
        break;
      }
    }
    return this.state.top = true, t;
  }
  inline(e, t = []) {
    return this.inlineQueue.push({ src: e, tokens: t }), t;
  }
  linkInText(e) {
    if (!e.includes("[")) return false;
    let t = this.tokenizer.rules.inline.link;
    for (let n of e.matchAll(this.tokenizer.rules.inline.blockSkip)) if (t.test(n[0]) && e.charAt(n.index - 1) !== "!") return true;
    for (let n of e.matchAll(this.tokenizer.rules.inline.reflinkSearch)) {
      let s = n[0], r2 = s.lastIndexOf("[");
      if (!(s.charAt(0) === "!" || !Object.hasOwn(this.tokens.links, q(s.slice(r2 + 1, -1)))) && !(r2 > 1 && this.linkInText(s.slice(1, r2 - 1)))) return true;
    }
    return false;
  }
  inlineTokens(e, t = []) {
    this.tokenizer.lexer = this;
    let n = this.state.linkParenPossible;
    this.state.linkParenPossible = n && e.includes(")");
    try {
      return this.#e(e, t);
    } finally {
      this.state.linkParenPossible = n;
    }
  }
  #e(e, t) {
    let n = e;
    if (this.tokens.links && e.includes("[")) {
      let i = this.tokenizer.rules.inline.reflinkSearch, u = (a) => {
        let p = a.lastIndexOf("[");
        if (!Object.hasOwn(this.tokens.links, q(a.slice(p + 1, -1)))) return a;
        if (p > 1 && a.charAt(0) !== "!") {
          let c = a.slice(1, p - 1);
          if (this.linkInText(c)) return "[" + c.replace(i, u) + "][" + "a".repeat(a.length - p - 2) + "]";
        }
        return "[" + "a".repeat(a.length - 2) + "]";
      };
      n = n.replace(i, u);
    }
    n = n.replace(this.tokenizer.rules.inline.anyPunctuation, (i) => "+".repeat(i.length)), n = n.replace(this.tokenizer.rules.inline.blockSkip, (i, u, a) => {
      let p = a ? a.length : 0;
      return i.slice(0, p) + "[" + "a".repeat(i.length - p - 2) + "]";
    }), n = this.options.hooks?.emStrongMask?.call({ lexer: this }, n) ?? n;
    let s = false, r2 = "", o = 1 / 0;
    for (; e; ) {
      if (e.length < o) o = e.length;
      else {
        this.infiniteLoopError(e.charCodeAt(0));
        break;
      }
      s || (r2 = ""), s = false;
      let i;
      if (this.options.extensions?.inline?.some((a) => (i = a.call({ lexer: this }, e, t)) ? (e = e.substring(i.raw.length), t.push(i), true) : false)) continue;
      if (i = this.tokenizer.escape(e)) {
        e = e.substring(i.raw.length), t.push(i);
        continue;
      }
      if (i = this.tokenizer.tag(e)) {
        e = e.substring(i.raw.length), t.push(i);
        continue;
      }
      if (i = this.tokenizer.link(e)) {
        e = e.substring(i.raw.length), t.push(i);
        continue;
      }
      if (i = this.tokenizer.reflink(e, this.tokens.links)) {
        e = e.substring(i.raw.length);
        let a = t.at(-1);
        i.type === "text" && a?.type === "text" ? (a.raw += i.raw, a.text += i.text) : t.push(i);
        continue;
      }
      if (i = this.tokenizer.emStrong(e, n, r2)) {
        e = e.substring(i.raw.length), t.push(i);
        continue;
      }
      if (i = this.tokenizer.codespan(e)) {
        e = e.substring(i.raw.length), t.push(i);
        continue;
      }
      if (i = this.tokenizer.br(e)) {
        e = e.substring(i.raw.length), t.push(i);
        continue;
      }
      if (i = this.tokenizer.del(e, n, r2)) {
        e = e.substring(i.raw.length), t.push(i);
        continue;
      }
      if (i = this.tokenizer.autolink(e)) {
        e = e.substring(i.raw.length), t.push(i);
        continue;
      }
      if (!this.state.inLink && (i = this.tokenizer.url(e))) {
        e = e.substring(i.raw.length), t.push(i);
        continue;
      }
      let u = e;
      if (this.options.extensions?.startInline) {
        let a = 1 / 0, p = e.slice(1), c;
        this.options.extensions.startInline.forEach((d) => {
          c = d.call({ lexer: this }, p), typeof c == "number" && c >= 0 && (a = Math.min(a, c));
        }), a < 1 / 0 && a >= 0 && (u = e.substring(0, a + 1));
      }
      if (i = this.tokenizer.inlineText(u)) {
        e = e.substring(i.raw.length), i.raw.slice(-1) !== "_" && (r2 = i.raw.slice(-1)), s = true;
        let a = t.at(-1);
        a?.type === "text" ? (a.raw += i.raw, a.text += i.text) : t.push(i);
        continue;
      }
      if (e) {
        this.infiniteLoopError(e.charCodeAt(0));
        break;
      }
    }
    return t;
  }
  infiniteLoopError(e) {
    let t = "Infinite loop on byte: " + e;
    if (this.options.silent) console.error(t);
    else throw new Error(t);
  }
};
var S = class {
  options;
  parser;
  constructor(e) {
    this.options = e || P;
  }
  space(e) {
    return "";
  }
  code({ text: e, lang: t, escaped: n }) {
    let s = (t || "").match(x.notSpaceStart)?.[0], r2 = e ? e.replace(x.endingNewline, "") + `
` : "";
    return s ? '<pre><code class="language-' + O(s) + '">' + (n ? r2 : O(r2, true)) + `</code></pre>
` : "<pre><code>" + (n ? r2 : O(r2, true)) + `</code></pre>
`;
  }
  blockquote({ tokens: e }) {
    return `<blockquote>
${this.parser.parse(e)}</blockquote>
`;
  }
  html({ text: e }) {
    return e;
  }
  def(e) {
    return "";
  }
  heading({ tokens: e, depth: t }) {
    return `<h${t}>${this.parser.parseInline(e)}</h${t}>
`;
  }
  hr(e) {
    return `<hr>
`;
  }
  list(e) {
    let t = e.ordered, n = e.start, s = "";
    for (let i = 0; i < e.items.length; i++) {
      let u = e.items[i];
      s += this.listitem(u);
    }
    let r2 = t ? "ol" : "ul", o = t && n !== 1 ? ' start="' + n + '"' : "";
    return "<" + r2 + o + `>
` + s + "</" + r2 + `>
`;
  }
  listitem(e) {
    return `<li>${this.parser.parse(e.tokens)}</li>
`;
  }
  checkbox({ checked: e }) {
    return "<input " + (e ? 'checked="" ' : "") + 'disabled="" type="checkbox"> ';
  }
  paragraph({ tokens: e }) {
    return `<p>${this.parser.parseInline(e)}</p>
`;
  }
  table(e) {
    let t = "", n = "";
    for (let r2 = 0; r2 < e.header.length; r2++) n += this.tablecell(e.header[r2]);
    t += this.tablerow({ text: n });
    let s = "";
    for (let r2 = 0; r2 < e.rows.length; r2++) {
      let o = e.rows[r2];
      n = "";
      for (let i = 0; i < o.length; i++) n += this.tablecell(o[i]);
      s += this.tablerow({ text: n });
    }
    return s && (s = `<tbody>${s}</tbody>`), `<table>
<thead>
` + t + `</thead>
` + s + `</table>
`;
  }
  tablerow({ text: e }) {
    return `<tr>
${e}</tr>
`;
  }
  tablecell(e) {
    let t = this.parser.parseInline(e.tokens), n = e.header ? "th" : "td";
    return (e.align ? `<${n} align="${e.align}">` : `<${n}>`) + t + `</${n}>
`;
  }
  strong({ tokens: e }) {
    return `<strong>${this.parser.parseInline(e)}</strong>`;
  }
  em({ tokens: e }) {
    return `<em>${this.parser.parseInline(e)}</em>`;
  }
  codespan({ text: e }) {
    return `<code>${O(e, true)}</code>`;
  }
  br(e) {
    return "<br>";
  }
  del({ tokens: e }) {
    return `<del>${this.parser.parseInline(e)}</del>`;
  }
  link({ href: e, title: t, text: n, tokens: s, autolink: r2 }) {
    let o = r2 ? O(n, true) : this.parser.parseInline(s), i = re(e);
    if (i === null) return o;
    e = O(i, r2);
    let u = '<a href="' + e + '"';
    return t && (u += ' title="' + O(t) + '"'), u += ">" + o + "</a>", u;
  }
  image({ href: e, title: t, text: n, tokens: s }) {
    s && (n = this.parser.parseInline(s, this.parser.textRenderer));
    let r2 = re(e);
    if (r2 === null) return O(n);
    e = r2;
    let o = `<img src="${O(e)}" alt="${O(n)}"`;
    return t && (o += ` title="${O(t)}"`), o += ">", o;
  }
  text(e) {
    return "tokens" in e && e.tokens ? this.parser.parseInline(e.tokens) : "escaped" in e && e.escaped ? e.text : O(e.text);
  }
};
var z = class {
  strong({ text: e }) {
    return e;
  }
  em({ text: e }) {
    return e;
  }
  codespan({ text: e }) {
    return e;
  }
  del({ text: e }) {
    return e;
  }
  html({ text: e }) {
    return e;
  }
  text({ text: e }) {
    return e;
  }
  link({ text: e }) {
    return "" + e;
  }
  image({ text: e }) {
    return "" + e;
  }
  br() {
    return "";
  }
  checkbox({ raw: e }) {
    return e;
  }
};
var T = class l2 {
  options;
  renderer;
  textRenderer;
  constructor(e) {
    this.options = e || P, this.options.renderer = this.options.renderer || new S(), this.renderer = this.options.renderer, this.renderer.options = this.options, this.renderer.parser = this, this.textRenderer = new z();
  }
  static parse(e, t) {
    return new l2(t).parse(e);
  }
  static parseInline(e, t) {
    return new l2(t).parseInline(e);
  }
  parse(e) {
    this.renderer.parser = this;
    let t = "";
    for (let n = 0; n < e.length; n++) {
      let s = e[n];
      if (this.options.extensions?.renderers?.[s.type]) {
        let o = s, i = this.options.extensions.renderers[o.type].call({ parser: this }, o);
        if (i !== false || !["space", "hr", "heading", "code", "table", "blockquote", "list", "checkbox", "html", "def", "paragraph", "text"].includes(o.type)) {
          t += i || "";
          continue;
        }
      }
      let r2 = s;
      switch (r2.type) {
        case "space": {
          t += this.renderer.space(r2);
          break;
        }
        case "hr": {
          t += this.renderer.hr(r2);
          break;
        }
        case "heading": {
          t += this.renderer.heading(r2);
          break;
        }
        case "code": {
          t += this.renderer.code(r2);
          break;
        }
        case "table": {
          t += this.renderer.table(r2);
          break;
        }
        case "blockquote": {
          t += this.renderer.blockquote(r2);
          break;
        }
        case "list": {
          t += this.renderer.list(r2);
          break;
        }
        case "checkbox": {
          t += this.renderer.checkbox(r2);
          break;
        }
        case "html": {
          t += this.renderer.html(r2);
          break;
        }
        case "def": {
          t += this.renderer.def(r2);
          break;
        }
        case "paragraph": {
          t += this.renderer.paragraph(r2);
          break;
        }
        case "text": {
          t += this.renderer.text(r2);
          break;
        }
        default: {
          let o = 'Token with "' + r2.type + '" type was not found.';
          if (this.options.silent) return console.error(o), "";
          throw new Error(o);
        }
      }
    }
    return t;
  }
  parseInline(e, t = this.renderer) {
    this.renderer.parser = this;
    let n = "";
    for (let s = 0; s < e.length; s++) {
      let r2 = e[s];
      if (this.options.extensions?.renderers?.[r2.type]) {
        let i = this.options.extensions.renderers[r2.type].call({ parser: this }, r2);
        if (i !== false || !["escape", "html", "link", "image", "checkbox", "strong", "em", "codespan", "br", "del", "text"].includes(r2.type)) {
          n += i || "";
          continue;
        }
      }
      let o = r2;
      switch (o.type) {
        case "escape": {
          n += t.text(o);
          break;
        }
        case "html": {
          n += t.html(o);
          break;
        }
        case "link": {
          n += t.link(o);
          break;
        }
        case "image": {
          n += t.image(o);
          break;
        }
        case "checkbox": {
          n += t.checkbox(o);
          break;
        }
        case "strong": {
          n += t.strong(o);
          break;
        }
        case "em": {
          n += t.em(o);
          break;
        }
        case "codespan": {
          n += t.codespan(o);
          break;
        }
        case "br": {
          n += t.br(o);
          break;
        }
        case "del": {
          n += t.del(o);
          break;
        }
        case "text": {
          n += t.text(o);
          break;
        }
        default: {
          let i = 'Token with "' + o.type + '" type was not found.';
          if (this.options.silent) return console.error(i), "";
          throw new Error(i);
        }
      }
    }
    return n;
  }
};
var _ = class {
  options;
  block;
  constructor(e) {
    this.options = e || P;
  }
  static passThroughHooks = /* @__PURE__ */ new Set(["preprocess", "postprocess", "processAllTokens", "emStrongMask"]);
  static passThroughHooksRespectAsync = /* @__PURE__ */ new Set(["preprocess", "postprocess", "processAllTokens"]);
  preprocess(e) {
    return e;
  }
  postprocess(e) {
    return e;
  }
  processAllTokens(e) {
    return e;
  }
  emStrongMask(e) {
    return e;
  }
  provideLexer(e = this.block) {
    return e ? R.lex : R.lexInline;
  }
  provideParser(e = this.block) {
    return e ? T.parse : T.parseInline;
  }
};
var F = class {
  defaults = I();
  options = this.setOptions;
  parse = this.parseMarkdown(true);
  parseInline = this.parseMarkdown(false);
  Parser = T;
  Renderer = S;
  TextRenderer = z;
  Lexer = R;
  Tokenizer = y;
  Hooks = _;
  constructor(...e) {
    this.use(...e);
  }
  walkTokens(e, t) {
    let n = [];
    for (let s of e) switch (n = n.concat(t.call(this, s)), s.type) {
      case "table": {
        let r2 = s;
        for (let o of r2.header) n = n.concat(this.walkTokens(o.tokens, t));
        for (let o of r2.rows) for (let i of o) n = n.concat(this.walkTokens(i.tokens, t));
        break;
      }
      case "list": {
        let r2 = s;
        n = n.concat(this.walkTokens(r2.items, t));
        break;
      }
      default: {
        let r2 = s;
        this.defaults.extensions?.childTokens?.[r2.type] ? this.defaults.extensions.childTokens[r2.type].forEach((o) => {
          let i = r2[o].flat(1 / 0);
          n = n.concat(this.walkTokens(i, t));
        }) : r2.tokens && (n = n.concat(this.walkTokens(r2.tokens, t)));
      }
    }
    return n;
  }
  use(...e) {
    let t = this.defaults.extensions || { renderers: {}, childTokens: {} };
    return e.forEach((n) => {
      let s = { ...n };
      if (s.async = this.defaults.async || s.async || false, n.extensions && (n.extensions.forEach((r2) => {
        if (!r2.name) throw new Error("extension name required");
        if ("renderer" in r2) {
          let o = t.renderers[r2.name];
          o ? t.renderers[r2.name] = function(...i) {
            let u = r2.renderer.apply(this, i);
            return u === false && (u = o.apply(this, i)), u;
          } : t.renderers[r2.name] = r2.renderer;
        }
        if ("tokenizer" in r2) {
          if (!r2.level || r2.level !== "block" && r2.level !== "inline") throw new Error("extension level must be 'block' or 'inline'");
          let o = t[r2.level];
          o ? o.unshift(r2.tokenizer) : t[r2.level] = [r2.tokenizer], r2.start && (r2.level === "block" ? t.startBlock ? t.startBlock.push(r2.start) : t.startBlock = [r2.start] : r2.level === "inline" && (t.startInline ? t.startInline.push(r2.start) : t.startInline = [r2.start]));
        }
        "childTokens" in r2 && r2.childTokens && (t.childTokens[r2.name] = r2.childTokens);
      }), s.extensions = t), n.renderer) {
        let r2 = this.defaults.renderer || new S(this.defaults);
        for (let o in n.renderer) {
          if (!(o in r2)) throw new Error(`renderer '${o}' does not exist`);
          if (["options", "parser"].includes(o)) continue;
          let i = o, u = n.renderer[i], a = r2[i];
          r2[i] = (...p) => {
            let c = u.apply(r2, p);
            return c === false && (c = a.apply(r2, p)), c || "";
          };
        }
        s.renderer = r2;
      }
      if (n.tokenizer) {
        let r2 = this.defaults.tokenizer || new y(this.defaults);
        for (let o in n.tokenizer) {
          if (!(o in r2)) throw new Error(`tokenizer '${o}' does not exist`);
          if (["options", "rules", "lexer"].includes(o)) continue;
          let i = o, u = n.tokenizer[i], a = r2[i];
          r2[i] = (...p) => {
            let c = u.apply(r2, p);
            return c === false && (c = a.apply(r2, p)), c;
          };
        }
        s.tokenizer = r2;
      }
      if (n.hooks) {
        let r2 = this.defaults.hooks || new _();
        for (let o in n.hooks) {
          if (!(o in r2)) throw new Error(`hook '${o}' does not exist`);
          if (["options", "block"].includes(o)) continue;
          let i = o, u = n.hooks[i], a = r2[i];
          _.passThroughHooks.has(o) ? r2[i] = (p) => {
            if (this.defaults.async && _.passThroughHooksRespectAsync.has(o)) return (async () => {
              let d = await u.call(r2, p);
              return a.call(r2, d);
            })();
            let c = u.call(r2, p);
            return a.call(r2, c);
          } : r2[i] = (...p) => {
            if (this.defaults.async) return (async () => {
              let d = await u.apply(r2, p);
              return d === false && (d = await a.apply(r2, p)), d;
            })();
            let c = u.apply(r2, p);
            return c === false && (c = a.apply(r2, p)), c;
          };
        }
        s.hooks = r2;
      }
      if (n.walkTokens) {
        let r2 = this.defaults.walkTokens, o = n.walkTokens;
        s.walkTokens = function(i) {
          let u = [];
          return u.push(o.call(this, i)), r2 && (u = u.concat(r2.call(this, i))), u;
        };
      }
      this.defaults = { ...this.defaults, ...s };
    }), this;
  }
  setOptions(e) {
    return this.defaults = { ...this.defaults, ...e }, this;
  }
  lexer(e, t) {
    return R.lex(e, t ?? this.defaults);
  }
  parser(e, t) {
    return T.parse(e, t ?? this.defaults);
  }
  parseMarkdown(e) {
    return (n, s) => {
      let r2 = { ...s }, o = { ...this.defaults, ...r2 }, i = this.onError(!!o.silent, !!o.async);
      if (this.defaults.async === true && r2.async === false) return i(new Error("marked(): The async option was set to true by an extension. Remove async: false from the parse options object to return a Promise."));
      if (typeof n > "u" || n === null) return i(new Error("marked(): input parameter is undefined or null"));
      if (typeof n != "string") return i(new Error("marked(): input parameter is of type " + Object.prototype.toString.call(n) + ", string expected"));
      if (o.hooks && (o.hooks.options = o, o.hooks.block = e), o.async) return (async () => {
        let u = o.hooks ? await o.hooks.preprocess(n) : n, p = await (o.hooks ? await o.hooks.provideLexer(e) : e ? R.lex : R.lexInline)(u, o), c = o.hooks ? await o.hooks.processAllTokens(p) : p;
        o.walkTokens && await Promise.all(this.walkTokens(c, o.walkTokens));
        let m = await (o.hooks ? await o.hooks.provideParser(e) : e ? T.parse : T.parseInline)(c, o);
        return o.hooks ? await o.hooks.postprocess(m) : m;
      })().catch(i);
      try {
        o.hooks && (n = o.hooks.preprocess(n));
        let a = (o.hooks ? o.hooks.provideLexer(e) : e ? R.lex : R.lexInline)(n, o);
        o.hooks && (a = o.hooks.processAllTokens(a)), o.walkTokens && this.walkTokens(a, o.walkTokens);
        let c = (o.hooks ? o.hooks.provideParser(e) : e ? T.parse : T.parseInline)(a, o);
        return o.hooks && (c = o.hooks.postprocess(c)), c;
      } catch (u) {
        return i(u);
      }
    };
  }
  onError(e, t) {
    return (n) => {
      if (n.message += `
Please report this to https://github.com/markedjs/marked.`, e) {
        let s = "<p>An error occurred:</p><pre>" + O(n.message + "", true) + "</pre>";
        return t ? Promise.resolve(s) : s;
      }
      if (t) return Promise.reject(n);
      throw n;
    };
  }
};
var E = new F();
function k(l3, e) {
  return E.parse(l3, e);
}
k.options = k.setOptions = function(l3) {
  return E.setOptions(l3), k.defaults = E.defaults, W(k.defaults), k;
};
k.getDefaults = I;
k.defaults = P;
function yt(...l3) {
  return E.use(...l3), k.defaults = E.defaults, W(k.defaults), k;
}
k.use = yt;
k.walkTokens = function(l3, e) {
  return E.walkTokens(l3, e);
};
k.parseInline = E.parseInline;
k.Parser = T;
k.parser = T.parse;
k.Renderer = S;
k.TextRenderer = z;
k.Lexer = R;
k.lexer = R.lex;
k.Tokenizer = y;
k.Hooks = _;
k.parse = k;
var gn = k.options;
var fn = k.setOptions;
var mn = k.walkTokens;
var xn = k.parseInline;
var Rn = T.parse;
var Tn = R.lex;

// src/lib/markdown.ts
var ENT = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
var esc = (s) => s.replace(/[&<>"']/g, (c) => ENT[c]);
var SAFE = /^(https?:|mailto:|#)/i;
function renderMarkdown(md) {
  const sections = sectionsOf(md);
  let next = 0;
  const topLevel = /* @__PURE__ */ new Set();
  const marked = new F({ gfm: true, async: false });
  marked.use({
    renderer: {
      html({ text, block }) {
        return block ? `<p>${esc(text)}</p>
` : esc(text);
      },
      heading(token) {
        const { tokens: tokens2, depth } = token;
        const inner = this.parser.parseInline(tokens2);
        if ((depth === 2 || depth === 3) && topLevel.has(token) && /^#{2,3}\s/.test(token.raw)) {
          const i = sections.findIndex((s, k2) => k2 >= next && s.level === depth && s.heading === token.text);
          if (i >= 0) {
            next = i + 1;
            return `<h${depth} id="${esc(sections[i].slug)}">${inner}</h${depth}>
`;
          }
        }
        return `<h${depth}>${inner}</h${depth}>
`;
      },
      link({ href, title, tokens: tokens2 }) {
        const text = this.parser.parseInline(tokens2);
        if (!SAFE.test(href.trim())) return text;
        return `<a href="${esc(href)}"${title ? ` title="${esc(title)}"` : ""} rel="noopener noreferrer">${text}</a>`;
      },
      image({ href, text }) {
        if (!/^https?:/i.test(href.trim())) return esc(text);
        return `<img src="${esc(href)}" alt="${esc(text)}" loading="lazy">`;
      }
    }
  });
  const tokens = marked.lexer(md);
  for (const t of tokens) if (t.type === "heading") topLevel.add(t);
  return marked.parser(tokens);
}

// src/design-page/build.ts
var VERSIONS_EMBEDDED = 5;
function fateOf(changelog, dismissed, round, n) {
  const at2 = appliedVersion(changelog, round, n);
  if (at2 !== null) return { fate: "applied", appliedIn: at2 };
  if (resolvedIn(changelog, round).has(n)) return { fate: "resolved" };
  const set = (dismissed[round] ?? []).find((x2) => x2.n === n);
  if (set) return { fate: "dismissed", ...set.reason ? { reason: set.reason } : {} };
  if (rewroteRound(changelog, round)) return { fate: "rewritten" };
  return { fate: "pending" };
}
function versionDiff(prev, next) {
  const before = designBody(prev);
  const after = designBody(next);
  const { changed, removed } = changedSections(before, after);
  const was = new Map(sectionsOf(before).map((s) => [s.slug, s.heading]));
  const now = new Map(sectionsOf(after).map((s) => [s.slug, s.heading]));
  const name = (m, slug) => slug === "_intro" ? "_intro" : m.get(slug) ?? slug;
  const added = changed.filter((s) => s !== "_intro" && !was.has(s));
  return {
    changed: changed.filter((s) => !added.includes(s)).map((s) => name(now, s)),
    added: added.map((s) => name(now, s)),
    removed: removed.map((s) => name(was, s))
  };
}
function buildDesignPageData(input) {
  const cur = parseDesign(input.current);
  const last = input.changelog[input.changelog.length - 1];
  const currentNo = last?.version ?? 1;
  const texts = { ...input.history, [currentNo]: input.current };
  const numbers = [.../* @__PURE__ */ new Set([...Object.keys(texts).map(Number), ...input.changelog.map((c) => c.version)])].filter((n) => texts[n] !== void 0).sort((a, b) => a - b);
  const from = Math.max(0, numbers.length - VERSIONS_EMBEDDED);
  const versions = numbers.slice(from).map((n, j2) => {
    const i = from + j2;
    const d = parseDesign(texts[n]);
    const entry = input.changelog.find((c) => c.version === n);
    return {
      version: n,
      date: entry?.date ?? "",
      note: entry?.note ?? "",
      words: d.words,
      html: renderMarkdown(d.body),
      toc: sectionsOf(d.body).map(({ level, heading, slug }) => ({ level, heading, slug })),
      diff: i === 0 ? null : { ...versionDiff(texts[numbers[i - 1]], texts[n]), ...numbers[i - 1] !== n - 1 ? { against: numbers[i - 1] } : {} }
    };
  });
  const earlier = input.changelog.filter((c) => c.version < (numbers[from] ?? Infinity)).map(({ version, date: date2, note }) => ({ version, date: date2, note }));
  const dismissed = input.dismissed ?? {};
  const known = /* @__PURE__ */ new Set([...input.changelog.map((e) => e.version), currentNo]);
  const valid = [...input.critiques ?? []].sort((a, b) => a.round - b.round).flatMap(({ round, critique }) => critique ? [{ round, critique }] : []);
  const critiques = valid.slice(-GATE_LIST_MAX).map(({ round, critique }) => {
    const more = Math.max(0, critique.proposals.length - GATE_LIST_MAX);
    return {
      round,
      version: critique.version,
      scope: critique.scope,
      verdict: critique.verdict ?? verdictOf(critique),
      proposals: critique.proposals.slice(-GATE_LIST_MAX).map((p) => ({
        ...p,
        section: line2(p.section),
        problem: line2(p.problem),
        change: line2(p.change),
        ...fateOf(input.changelog, dismissed, round, p.n)
      })),
      ...more ? { proposalsMore: more } : {},
      ...known.has(critique.version) ? {} : { unknownVersion: true }
    };
  });
  const critiquesMore = valid.length - critiques.length;
  const kinds = input.changelog.map(entryKind);
  return {
    meta: cur.meta,
    words: cur.words,
    rounds: valid.length,
    pending: pendingProposals(input.changelog, input.critiques ?? [], dismissed).length,
    source: input.source,
    current: currentNo,
    status: cur.meta.status,
    amended: cur.meta.status === "approved" && kinds.lastIndexOf("amend") > kinds.lastIndexOf("approve"),
    critiques,
    ...critiquesMore ? { critiquesMore } : {},
    versions,
    earlier
  };
}

// src/cli/design-files.ts
var import_node_fs4 = require("node:fs");
var import_node_path4 = __toESM(require("node:path"), 1);
var import_node_child_process2 = require("node:child_process");

// src/lib/bound-fs.ts
var import_node_fs3 = require("node:fs");
var import_node_path3 = __toESM(require("node:path"), 1);
var import_node_child_process = require("node:child_process");

// src/lib/forge-run.ts
var LOCALE = /^[a-z]{2,3}([-_][A-Za-z0-9]{2,8})?$/;
var isLocale = (x2) => typeof x2 === "string" && LOCALE.test(x2);
var isCount = (x2) => typeof x2 === "number" && Number.isInteger(x2) && x2 >= 0;
var isPositiveInt = (x2) => isCount(x2) && x2 > 0;
var isPositive = (x2) => typeof x2 === "number" && Number.isFinite(x2) && x2 > 0;
function parseRun(text) {
  if (text === null) return null;
  let o;
  try {
    const x2 = JSON.parse(text);
    if (!x2 || typeof x2 !== "object" || Array.isArray(x2)) return null;
    o = x2;
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
  if (isLocale(o.locale)) run2.locale = o.locale;
  return run2;
}

// src/lib/execution-state.ts
var SAFE_ID2 = /^[A-Za-z0-9_\-.]{1,120}$/;
var isSafeId = (s) => typeof s === "string" && SAFE_ID2.test(s) && s !== "." && s !== "..";
var RUN_BRANCH = /^[A-Za-z0-9_./][A-Za-z0-9_\-./]{0,119}$/;
var isRunBranch = (s) => typeof s === "string" && RUN_BRANCH.test(s) && !s.includes("..");
var TASK_STATUSES2 = ["running", "accepted", "integrated", "conflict", "blocked", "stopped"];
var STOPS = ["finished", "stalled", "stopped", "budget", "migrated"];
var MAX_TASKS = 500;
var isObj3 = (x2) => !!x2 && typeof x2 === "object" && !Array.isArray(x2);
var str3 = (x2) => typeof x2 === "string" && x2 ? x2 : null;
var iso3 = (x2) => typeof x2 === "string" && !Number.isNaN(Date.parse(x2)) ? x2 : null;
var FUTURE_SKEW_MS2 = 12e4;
var finishedOf = (x2, now) => {
  const v = iso3(x2);
  if (!v) return null;
  return now !== void 0 && Number.isFinite(now) && Date.parse(v) - now > FUTURE_SKEW_MS2 ? null : v;
};
var int2 = (x2, min, max, dflt) => typeof x2 === "number" && Number.isInteger(x2) ? Math.min(max, Math.max(min, x2)) : dflt;
var oneOf = (list, x2) => list.includes(x2) ? x2 : null;
var cleanTitle = (x2) => typeof x2 === "string" ? x2.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim().slice(0, 200) : "";
function normalizeTask2(x2, now) {
  if (!isObj3(x2)) return null;
  const status = oneOf(TASK_STATUSES2, x2.status);
  const stage = oneOf(STAGES, x2.stage);
  const executor = oneOf(["subagents", "sessions", "manual"], x2.executor);
  const worktree = typeof x2.worktree === "string" ? x2.worktree : null;
  const branch = str3(x2.branch);
  const startedAt = iso3(x2.startedAt);
  if (!status || !stage || !executor || worktree === null || !branch || !startedAt) return null;
  const title = cleanTitle(x2.title);
  return {
    status,
    stage,
    executor,
    worktree,
    branch,
    startedAt,
    stageSince: iso3(x2.stageSince) ?? startedAt,
    round: int2(x2.round, 0, 99, 0),
    attempts: int2(x2.attempts, 0, 99, 0),
    agent: str3(x2.agent),
    updatedAt: iso3(x2.updatedAt) ?? startedAt,
    detail: typeof x2.detail === "string" ? x2.detail.slice(0, 500) : null,
    ...iso3(x2.nudgedAt) ? { nudgedAt: iso3(x2.nudgedAt) } : {},
    ...finishedOf(x2.finishedAt, now) ? { finishedAt: finishedOf(x2.finishedAt, now) } : {},
    ...title ? { title } : {},
    ...typeof x2.sha === "string" && /^[0-9a-f]{7,40}$/i.test(x2.sha) ? { sha: x2.sha } : {}
  };
}
function normalizeExecution(x2, now) {
  if (!isObj3(x2)) return null;
  const mode = oneOf(["subagents", "sessions"], x2.mode);
  const kind = oneOf(["plan", "ephemeral"], x2.kind) ?? "plan";
  const runId = str3(x2.runId), project = str3(x2.project), base = str3(x2.base), branch = str3(x2.branch), coordinator = str3(x2.coordinator);
  const startedAt = iso3(x2.startedAt);
  if (!mode || !runId || !project || !base || !branch || !coordinator || !startedAt) return null;
  if (!isSafeId(runId) || !isSafeId(coordinator) || !isRunBranch(branch)) return null;
  const tasks = {};
  if (isObj3(x2.tasks)) {
    for (const [id, t] of Object.entries(x2.tasks).slice(0, MAX_TASKS)) {
      const n = isPlanId(id) ? normalizeTask2(t, now) : null;
      if (n) tasks[id] = n;
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
    parallel: int2(x2.parallel, 1, 10, 3),
    mergeOnFinish: x2.mergeOnFinish === true,
    hookSession: isSafeId(x2.hookSession) ? x2.hookSession : null,
    active: x2.active === true,
    stopReason: oneOf(STOPS, x2.stopReason),
    stallReason: typeof x2.stallReason === "string" ? x2.stallReason.slice(0, 1e3) : null,
    lastStepAt: iso3(x2.lastStepAt),
    lastBlockStep: iso3(x2.lastBlockStep),
    sleepUntil: iso3(x2.sleepUntil),
    // C2: closedBy only means something with a closedAt; an older file has neither.
    closedAt: iso3(x2.closedAt),
    closedBy: iso3(x2.closedAt) ? oneOf(["merge", "close"], x2.closedBy) : null,
    ...typeof x2.planned === "number" && Number.isInteger(x2.planned) ? { planned: Math.min(MAX_TASKS, Math.max(0, x2.planned)) } : {},
    ...x2.autonomy === "auto" ? { autonomy: "auto" } : {},
    ...isLocale(x2.locale) ? { locale: x2.locale } : {}
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
var LIVE_SILENT_MINUTES = 7;
var LIVE_STOPPED_MINUTES = 12;
var LIVE_MAX_AGE_HOURS = 24;
var FORGE_DOC_MAX_BYTES = 8 * 1024;
function normalizeLive(x2) {
  if (!isObj3(x2)) return null;
  const sessionId = str3(x2.sessionId), ts = iso3(x2.ts);
  const role = oneOf(["coordinator", "executor", "manual"], x2.role);
  if (!sessionId || !ts || !role) return null;
  const agents = Array.isArray(x2.agents) ? x2.agents.filter(isObj3).map((a) => ({ id: str3(a.id), type: str3(a.type) ?? "", since: iso3(a.since) })).filter((a) => !!a.id && !!a.since).slice(0, 20) : [];
  return { sessionId, role, ts, agents, runId: str3(x2.runId), task: str3(x2.task), event: (str3(x2.event) ?? "").slice(0, 40), ended: x2.ended === true };
}

// src/lib/bound.ts
var BOUND_VIAS = ["work", "design", "forge-run", "forge-member", "forge-infinite"];
var BOUND_END_REASONS = ["clear", "resume", "logout", "prompt_input_exit", "other", "released"];
var MAX_SEATS = 10;
var MAX_PROJECTS = 50;
var BOUND_LEASE_MS = 5 * 6e4;
var BOUND_MAX_BYTES = 4096;
var SESSION_MAX_BYTES = 8 * 1024;
var BOUND_REREAD_MS = 8;
var CACHE_DOCS_MAX = 500;
var isBoundVia = (x2) => BOUND_VIAS.includes(x2);
var isEndReason = (x2) => BOUND_END_REASONS.includes(x2);
var endReasonOf = (x2) => isEndReason(x2) && x2 !== "released" ? x2 : "other";
function date(x2, now) {
  if (typeof x2 !== "string") return null;
  const t = Date.parse(x2);
  if (!Number.isFinite(t)) return null;
  return now !== void 0 && Number.isFinite(now) && t - now > FUTURE_SKEW_MS2 ? null : x2;
}
function normalizeBound(x2, now) {
  if (!x2 || typeof x2 !== "object" || Array.isArray(x2)) return null;
  const o = x2;
  if (!isSafeId(o.sid) || !isSafeId(o.claude) || !isBoundVia(o.via)) return null;
  const since = date(o.since, now);
  const seenAt = date(o.seenAt, now);
  if (!since || !seenAt) return null;
  const ended = o.endedAt === null || o.endedAt === void 0;
  const endedAt = ended ? null : date(o.endedAt, now);
  if (!ended && endedAt === null) return null;
  let endReason = null;
  if (o.endReason !== null && o.endReason !== void 0) {
    if (!isEndReason(o.endReason)) return null;
    endReason = o.endReason;
  }
  const pid = typeof o.pid === "number" && Number.isInteger(o.pid) && o.pid > 0 ? o.pid : null;
  return { sid: o.sid, claude: o.claude, pid, via: o.via, since, seenAt, endedAt, endReason: endedAt ? endReason : null };
}
function bindingLive(b, now) {
  const seen = Date.parse(b.seenAt);
  return b.endedAt === null && Number.isFinite(seen) && now < seen + BOUND_LEASE_MS;
}
function parseBound(text, now) {
  if (typeof text !== "string" || !text || text.length > BOUND_MAX_BYTES) return null;
  try {
    return normalizeBound(JSON.parse(text), now);
  } catch {
    return null;
  }
}

// src/lib/run-ttl.ts
var STALE_RUN_TTL_MS = 24 * 36e5;

// src/lib/execution-view.ts
var FUTURE_TOLERANCE_MS = 2 * 6e4;
var AGENT_ALIVE_MS = 3 * 36e5;
var lastMovedAt = (e) => e.lastStepAt ?? e.startedAt;
var VISIBLE_STOPS = ["stalled", "stopped", "budget", "finished"];
function isVisibleRun(e, now, role) {
  if (!e || e.closedAt) return false;
  if (e.active) return true;
  if (!e.stopReason || !VISIBLE_STOPS.includes(e.stopReason)) return false;
  if (role === "owner") return true;
  const moved = usable(lastMovedAt(e), now);
  return moved !== null && now < moved + STALE_RUN_TTL_MS;
}
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
var freshSignal = (d, now) => {
  const t = usable(d.ts, now);
  return t !== null && now - t < LIVE_MAX_AGE_HOURS * 36e5;
};
function coordinatorOf(e, live, now, stepAt) {
  const signal = live.filter((d) => freshSignal(d, now) && d.role === "coordinator" && d.runId === e.runId && (!e.hookSession || d.sessionId === e.hookSession)).reduce((best, d) => !best || Date.parse(d.ts) > Date.parse(best.ts) ? d : best, null);
  const candidates = [signal?.ts ?? null, stepAt].map((ts) => ({ ts, t: usable(ts, now) })).filter((c) => c.t !== null);
  const lastSeen = candidates.length ? candidates.reduce((a, b) => b.t > a.t ? b : a).ts : null;
  const waiting = !!e.active && !!signal && !signal.ended && signal.agents.some((a) => {
    const t = usable(a.since, now);
    return t !== null && now - t < AGENT_ALIVE_MS;
  });
  const liveness2 = !e.active ? "stopped" : signal?.ended ? "stopped" : waiting ? "alive" : signalLiveness(lastSeen, false, now);
  return { signal, lastSeen, waiting, liveness: liveness2 };
}
function coordinatorLiveness(e, signal, now, activity = {}) {
  if (e.active && !e.hookSession) return "stopped";
  const own = e.hookSession && signal?.sessionId === e.hookSession ? signal : null;
  if (own?.ended === true) return "stopped";
  const open = !!e.hookSession && (activity.bindings ?? []).some((b) => b.claude === e.hookSession && bindingLive(b, now));
  return e.active && (open || activity.busy === true) ? "alive" : coordinatorOf(e, own ? [own] : [], now, lastMovedAt(e)).liveness;
}
function coordinatorGone(e, signal, now, activity = {}) {
  if (!e) return false;
  if (e.hookSession && signal?.sessionId === e.hookSession && signal.ended === true) return true;
  return e.active && coordinatorLiveness(e, signal, now, activity) === "stopped";
}

// src/lib/forge-activity.ts
function memberOfHook(members, sessionId, runId) {
  const byHook = members.find((m) => m.runId === runId && m.hookSession === sessionId);
  if (byHook) return byHook;
  const direct = members.find((m) => m.sessionId === sessionId);
  return direct && direct.runId === runId && (direct.hookSession === null || direct.hookSession === sessionId) ? direct : null;
}
function forgeRoleOf(a, sessionId) {
  if (!isSafeId(sessionId)) return null;
  const e = a.execution;
  if (e?.active && e.hookSession === sessionId) return "coordinator";
  if (e?.active && memberOfHook(a.members, sessionId, e.runId)) return "member";
  if (a.infinite?.active && a.infinite.sessionId === sessionId) return "infinite";
  return null;
}

// src/lib/viewer-role.ts
var PREVIOUS_OFFER_MS = 24 * 36e5;
var NONE = { role: "none", subject: null, binding: null, member: null, coordinator: false, since: null, task: null };
var time2 = (s) => {
  const t = s ? Date.parse(s) : NaN;
  return Number.isFinite(t) ? t : -Infinity;
};
var newest = (list, at2) => list.reduce((best, b) => !best || at2(b) > at2(best) ? b : best, null);
function describeViewer(i) {
  const list = i.bound === null ? [] : "sid" in i.bound ? [i.bound] : i.bound;
  const e = i.execution;
  const taskOf = (b) => i.openTasks?.[b.sid] ?? null;
  const sid = i.sessionId;
  if (sid !== null) {
    if (e && e.hookSession === sid && isVisibleRun(e, i.now, "owner")) {
      return { ...NONE, role: "owner", subject: "execution", coordinator: true, since: lastMovedAt(e) };
    }
    const m = e ? memberOfHook(i.members, sid, e.runId) : null;
    if (e && m && isVisibleRun(e, i.now, "owner")) return { ...NONE, role: "owner", subject: "execution", member: m, since: m.since, task: m.task };
    const own = newest(list.filter((b) => b.claude === sid), (b) => time2(b.seenAt));
    if (own) return { ...NONE, role: "owner", subject: "binding", binding: own, since: own.since, task: taskOf(own) };
  }
  if (e && e.active && !i.coordinatorEnded && isVisibleRun(e, i.now, "other-live")) {
    return { ...NONE, role: "other-live", subject: "execution", since: lastMovedAt(e) };
  }
  if (e && (!e.active || i.coordinatorEnded) && isVisibleRun(e, i.now, "previous")) {
    return { ...NONE, role: "previous", subject: "execution", since: lastMovedAt(e) };
  }
  const others = list.filter((b) => b.claude !== sid);
  const live = newest(others.filter((b) => bindingLive(b, i.now)), (b) => time2(b.seenAt));
  if (live) return { ...NONE, role: "other-live", subject: "binding", binding: live, since: live.seenAt, task: taskOf(live) };
  const offerAt = (b) => time2(b.endedAt ?? b.seenAt);
  const offered = others.filter((b) => !bindingLive(b, i.now) && offerAt(b) + PREVIOUS_OFFER_MS > i.now);
  const prev = newest(offered.filter((b) => taskOf(b) !== null), offerAt) ?? newest(offered, offerAt);
  if (prev) return { ...NONE, role: "previous", subject: "binding", binding: prev, since: prev.endedAt ?? prev.seenAt, task: taskOf(prev) };
  return NONE;
}

// src/lib/pid.ts
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

// src/lib/bound-fs.ts
var boundFile = (seatDir) => import_node_path3.default.join(seatDir, "bound.json");
var seatsDir = (wpDir) => import_node_path3.default.join(wpDir, "seats");
var lastHeadFile = (seatDir) => import_node_path3.default.join(seatDir, "last-head.json");
var HEADS_MAX = 50;
var SHA2 = /^[0-9a-f]{7,64}$/;
var RENAME_TRIES = 50;
var RENAME_BUSY = /* @__PURE__ */ new Set(["EPERM", "EACCES", "EBUSY"]);
var pause = (ms) => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};
var pause1ms = () => pause(1);
function readText(file, max) {
  try {
    return (0, import_node_fs3.statSync)(file).size > max ? null : (0, import_node_fs3.readFileSync)(file, "utf8");
  } catch {
    return null;
  }
}
function readBound(file, now) {
  const text = readText(file, BOUND_MAX_BYTES);
  const b = parseBound(text, now);
  if (b || text === null) return b;
  pause(BOUND_REREAD_MS);
  return parseBound(readText(file, BOUND_MAX_BYTES), now);
}
function writeAtomic(file, text) {
  (0, import_node_fs3.mkdirSync)(import_node_path3.default.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    (0, import_node_fs3.writeFileSync)(tmp, text);
    for (let i = 1; ; i++) {
      try {
        (0, import_node_fs3.renameSync)(tmp, file);
        return;
      } catch (e) {
        if (i >= RENAME_TRIES || !RENAME_BUSY.has(String(e.code))) throw e;
        pause1ms();
      }
    }
  } finally {
    (0, import_node_fs3.rmSync)(tmp, { force: true });
  }
}
function readBinding(seatDir, sid, now) {
  const b = readBound(boundFile(seatDir), now);
  return b && b.sid === sid ? b : null;
}
function writeBinding(file, doc) {
  writeAtomic(file, `${JSON.stringify(doc, null, 2)}
`);
}
function checkoutSid(wpDir, now) {
  try {
    const s = JSON.parse(readText(import_node_path3.default.join(wpDir, "session.json"), SESSION_MAX_BYTES) ?? "");
    if (typeof s?.sessionId === "string" && s.sessionId) return s.sessionId;
  } catch {
  }
  return readBound(boundFile(wpDir), now)?.sid ?? null;
}
function readSeats(wpDir, now) {
  const out = [];
  const own = checkoutSid(wpDir, now);
  if (own && isSafeId(own)) out.push({ dir: wpDir, sid: own, checkout: true, bound: readBinding(wpDir, own, now) });
  let names = [];
  try {
    names = (0, import_node_fs3.readdirSync)(seatsDir(wpDir), { withFileTypes: true }).filter((d) => d.isDirectory() && isSafeId(d.name) && d.name !== own).map((d) => d.name).sort().slice(0, MAX_SEATS);
  } catch {
    names = [];
  }
  for (const n of names) {
    const dir = import_node_path3.default.join(seatsDir(wpDir), n);
    out.push({ dir, sid: n, checkout: false, bound: readBinding(dir, n, now) });
  }
  return out;
}
var readBindings = (wpDir, now) => readSeats(wpDir, now).flatMap((s) => s.bound ? [s.bound] : []);
var PID_MAX = 2147483647;
var pidFromEnv = (env) => {
  const v = env?.CLAUDE_PID;
  return v !== void 0 && /^[1-9]\d{0,9}$/.test(v) && Number(v) <= PID_MAX ? Number(v) : null;
};
function boundLive(b, now, alive = pidAlive) {
  return bindingLive(b, now) && (b.pid === null || alive(b.pid));
}
function settleBinding(b, now, alive = pidAlive) {
  return bindingLive(b, now) && b.pid !== null && !alive(b.pid) ? { ...b, endedAt: b.seenAt } : b;
}
function claudeBindings(root, claude, now, alive = pidAlive) {
  let names = [];
  try {
    names = (0, import_node_fs3.readdirSync)(import_node_path3.default.join(root, ".waypoint"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).slice(0, MAX_PROJECTS);
  } catch {
    return [];
  }
  return names.flatMap((n) => readBindings(import_node_path3.default.join(root, ".waypoint", n), now)).filter((b) => b.claude === claude).map((b) => settleBinding(b, now, alive));
}
function openTasksOf(wpDir) {
  const out = /* @__PURE__ */ Object.create(null);
  const dir = import_node_path3.default.join(wpDir, "dbcache", "state");
  let names = [];
  try {
    names = (0, import_node_fs3.readdirSync)(dir).filter((f) => f.endsWith(".json")).sort().slice(0, CACHE_DOCS_MAX);
  } catch {
    return out;
  }
  for (const f of names) {
    try {
      const st2 = JSON.parse((0, import_node_fs3.readFileSync)(import_node_path3.default.join(dir, f), "utf8"));
      if ((st2?.status === "claimed" || st2?.status === "in_progress") && typeof st2.owner === "string" && !(st2.owner in out)) out[st2.owner] = f.slice(0, -5);
    } catch {
    }
  }
  return out;
}
function secondSeatOf(wpDir, claude, open, now, alive = pidAlive) {
  const own = checkoutSid(wpDir, now);
  for (let n = 2; n <= MAX_SEATS + 1; n++) {
    const sid = `main-${n}`;
    if (sid === own) continue;
    const b = readBinding(import_node_path3.default.join(seatsDir(wpDir), sid), sid, now);
    if (!b || b.claude === claude || !boundLive(b, now, alive) && !open[sid]) return sid;
  }
  return null;
}
function leftSeatOf(seats, open, now, alive = pidAlive) {
  let best = null;
  let bestAt = -Infinity;
  for (const s of seats) {
    if (!s.bound || !open[s.sid] || boundLive(s.bound, now, alive)) continue;
    const at2 = Date.parse(settleBinding(s.bound, now, alive).endedAt ?? s.bound.seenAt);
    if (Number.isFinite(at2) && at2 + PREVIOUS_OFFER_MS > now && at2 > bestAt) {
      best = s;
      bestAt = at2;
    }
  }
  return best;
}
var RECORDED_MAX = 20;
var RECORDED_TOPS = 10;
function headOf(cwd) {
  try {
    const [top, head] = (0, import_node_child_process.execFileSync)("git", ["-C", cwd, "rev-parse", "--show-toplevel", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split(/\r?\n/).map((l3) => l3.trim());
    return top && head && SHA2.test(head) ? { top: import_node_path3.default.resolve(top), head } : null;
  } catch {
    return null;
  }
}
function readLastHead(seatDir) {
  const text = readText(lastHeadFile(seatDir), 64 * 1024);
  if (text === null) return null;
  try {
    const o = JSON.parse(text);
    if (!o || !isSafeId(o.session) || !o.heads || typeof o.heads !== "object" || Array.isArray(o.heads)) return null;
    const heads = {};
    for (const [k2, v] of Object.entries(o.heads).slice(-HEADS_MAX)) if (typeof v === "string" && SHA2.test(v)) heads[k2] = v;
    const recorded = {};
    if (o.recorded && typeof o.recorded === "object" && !Array.isArray(o.recorded)) {
      for (const [k2, v] of Object.entries(o.recorded).slice(-RECORDED_TOPS)) {
        if (Array.isArray(v)) recorded[k2] = v.filter((s) => typeof s === "string" && SHA2.test(s)).slice(-RECORDED_MAX);
      }
    }
    return { session: o.session, heads, recorded };
  } catch {
    return null;
  }
}
function writeLastHead(seatDir, doc) {
  const recorded = Object.fromEntries(Object.entries(doc.recorded ?? {}).filter(([, v]) => v.length).slice(-RECORDED_TOPS).map(([k2, v]) => [k2, v.slice(-RECORDED_MAX)]));
  const out = { session: doc.session, heads: Object.fromEntries(Object.entries(doc.heads).slice(-HEADS_MAX)), ...Object.keys(recorded).length ? { recorded } : {} };
  writeAtomic(lastHeadFile(seatDir), `${JSON.stringify(out)}
`);
}
function recordBase(seatDir, session, cwd) {
  const at2 = headOf(cwd);
  if (!at2) return;
  const lh = readLastHead(seatDir);
  const mine = lh && lh.session === session ? lh : null;
  const heads = mine?.heads ?? {};
  if (heads[at2.top] !== at2.head) writeLastHead(seatDir, { session, heads: { ...heads, [at2.top]: at2.head }, recorded: mine?.recorded });
}

// src/cli/design-files.ts
function repoRootOf(dir) {
  const parts = import_node_path4.default.resolve(dir).split(import_node_path4.default.sep);
  if (parts.length >= 4 && parts[parts.length - 3] === "docs" && parts[parts.length - 2] === "waypoint") return import_node_path4.default.resolve(dir, "..", "..", "..");
  try {
    const top = (0, import_node_child_process2.execFileSync)("git", ["rev-parse", "--show-toplevel"], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return top ? import_node_path4.default.resolve(top) : dir;
  } catch {
    return dir;
  }
}
function designFilesOf(file, project) {
  const abs = import_node_path4.default.resolve(file);
  const dir = import_node_path4.default.dirname(abs);
  return { file: abs, dir, critiques: import_node_path4.default.join(dir, "design", "critiques"), legacy: import_node_path4.default.join(repoRootOf(dir), ".waypoint", project) };
}
function readCritiques(f) {
  const found = /* @__PURE__ */ new Map();
  const scan = (dir, re2) => {
    if (!(0, import_node_fs4.existsSync)(dir)) return;
    for (const name of (0, import_node_fs4.readdirSync)(dir)) {
      const m = re2.exec(name);
      if (m) found.set(Number(m[1]), import_node_path4.default.join(dir, name));
    }
  };
  scan(f.legacy, LEGACY_CRITIQUE_FILE);
  scan(f.critiques, CRITIQUE_FILE);
  return [...found.entries()].sort((a, b) => a[0] - b[0]).map(([round, file]) => {
    let critique = null;
    try {
      critique = parseCritique((0, import_node_fs4.readFileSync)(file, "utf8"));
    } catch {
      critique = null;
    }
    return { round, critique, file };
  });
}
function readDismissedOf(f) {
  const read2 = (p) => {
    try {
      if ((0, import_node_fs4.statSync)(p).size > DISMISSED_MAX_CHARS) return {};
      return parseDismissed((0, import_node_fs4.readFileSync)(p, "utf8"));
    } catch {
      return {};
    }
  };
  return unionDismissed(read2(import_node_path4.default.join(f.legacy, "dismissed.json")), read2(import_node_path4.default.join(f.critiques, "dismissed.json")));
}
function writeDismissed(f, d) {
  const p = import_node_path4.default.join(f.critiques, "dismissed.json");
  const kept = Object.fromEntries(Object.entries(d).filter(([, items]) => items.length));
  writeAtomic(p, `${JSON.stringify(kept, null, 2)}
`);
  return p;
}
function readHistory(dir) {
  const hist = import_node_path4.default.join(dir, "design", "history");
  const out = {};
  for (const v of listVersions((0, import_node_fs4.existsSync)(hist) ? (0, import_node_fs4.readdirSync)(hist) : [])) out[v] = (0, import_node_fs4.readFileSync)(import_node_path4.default.join(hist, `v${v}.md`), "utf8");
  return out;
}

// src/lib/design-round.ts
function budgetRound(changelog, round) {
  const reopen = [...changelog].reverse().find((e) => entryKind(e) === "reopen");
  const n = Number.isFinite(round) ? round : 1;
  return Math.max(1, n - entryRound(reopen));
}
function nextRound(i) {
  const last = i.changelog[i.changelog.length - 1];
  const round = Math.max(entryRound(last), ...i.critiques.map((c) => c.round)) + 1;
  const reopened = i.changelog.some((e) => entryKind(e) === "reopen");
  const cycle = budgetRound(i.changelog, round);
  const verify = i.verify ?? false;
  const budget = budgetFor(cycle, verify);
  const latest = [...i.critiques].filter((c) => c.critique !== null).sort((a, b) => b.round - a.round)[0]?.critique ?? null;
  const since = latest?.version ?? null;
  const prev = since === null ? void 0 : i.history[since];
  const diff = prev === void 0 ? null : changedSections(designBody(prev), designBody(i.current));
  const removalOnly = !!diff && diff.changed.length === 0 && diff.removed.length > 0;
  const scope = i.full || !diff || removalOnly ? "full" : scopeFor({ round: cycle, verify, reopened, changed: diff.changed.filter((s) => s !== "_intro").length + diff.removed.length, total: i.sections.length });
  return {
    round,
    version: last?.version ?? 0,
    budget,
    scope,
    since,
    changed: diff?.changed ?? [],
    removed: diff?.removed ?? [],
    review: removalOnly ? ["_intro", ...i.sections] : scope === "full" ? i.sections : diff?.changed ?? []
  };
}

// src/lib/metrics.ts
function computeMetrics(plan, states, now) {
  const st2 = (id) => statusOf(states, id);
  const total = plan.tasks.length;
  const done = plan.tasks.filter((t) => st2(t.id) === "done").length;
  const byPhase = {};
  for (const ph of plan.phases) {
    const ts = plan.tasks.filter((t) => t.phase === ph.id);
    const d = ts.filter((t) => st2(t.id) === "done").length;
    const started = ts.some((t) => st2(t.id) !== "free");
    byPhase[ph.id] = { done: d, total: ts.length, status: ts.length > 0 && d === ts.length ? "done" : started ? "in_progress" : ph.plan_status };
  }
  const byTrack = {};
  for (const tr of plan.tracks) {
    const ts = plan.tasks.filter((t) => t.track === tr.id);
    byTrack[tr.id] = { done: ts.filter((t) => st2(t.id) === "done").length, total: ts.length };
  }
  const byVersion = {};
  const versions = plan.versions ?? [];
  for (const v of versions) {
    const phases = new Set(v.phases);
    const ts = plan.tasks.filter((t) => phases.has(t.phase));
    const d = ts.filter((t) => st2(t.id) === "done").length;
    byVersion[v.id] = { done: d, total: ts.length, percent: ts.length ? Math.round(d / ts.length * 100) : 0 };
  }
  const open = versions.find((v) => byVersion[v.id].done < byVersion[v.id].total);
  const currentVersion = open?.id ?? versions.at(-1)?.id ?? null;
  const durations = [];
  const starts = [];
  for (const t of plan.tasks) {
    const s = states[t.id];
    const start = s?.startedAt ?? s?.claimedAt;
    if (start && Number.isFinite(Date.parse(start))) starts.push(Date.parse(start));
    if (s?.status === "done" && s.startedAt && s.doneAt) {
      const d = Math.max(0, (Date.parse(s.doneAt) - Date.parse(s.startedAt)) / 6e4);
      if (Number.isFinite(d)) durations.push(d);
    }
  }
  const paceMin = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;
  return {
    total,
    done,
    percent: total ? Math.round(done / total * 100) : 0,
    inProgress: plan.tasks.filter((t) => ["claimed", "in_progress"].includes(st2(t.id))).map((t) => t.id),
    blocked: plan.tasks.filter((t) => st2(t.id) === "blocked").map((t) => t.id),
    phasesDone: Object.values(byPhase).filter((p) => p.status === "done").length,
    phaseCount: plan.phases.length,
    paceMin,
    startedAt: starts.length ? new Date(Math.min(...starts)).toISOString() : null,
    byPhase,
    byTrack,
    byVersion,
    currentVersion
  };
}

// src/lib/timeline.ts
var H = 36e5;
var SPAN = { "6h": 6 * H, "1d": 24 * H, "3d": 72 * H, "1w": 168 * H, "1m": 720 * H };
var TICK = { "6h": H, "1d": 2 * H, "3d": 6 * H, "1w": 24 * H, "1m": 72 * H };
var DEFAULT_ESTIMATE_MIN = 30;
var MIN_SPAN = 30 * 6e4;
var MAX_SPAN = 180 * 24 * H;
var MAX_PAN = 10 * 365 * 24 * H;
var STEPS = [15 * 6e4, 30 * 6e4, H, 2 * H, 3 * H, 6 * H, 12 * H, 24 * H, 48 * H, 168 * H, 336 * H, 720 * H];

// src/lib/insights.ts
var MIN2 = 6e4;
var isDone = (states, id) => states[id]?.status === "done";
function remainingMin(plan, states, id, now) {
  const t = plan.tasks.find((x2) => x2.id === id);
  const raw = Number(t?.estimate_min);
  const est = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_ESTIMATE_MIN;
  const s = states[id];
  if (s?.status === "done") return 0;
  const start = s?.startedAt ?? s?.claimedAt;
  if ((s?.status === "in_progress" || s?.status === "claimed") && start) {
    const spent = (now - Date.parse(start)) / MIN2;
    return Number.isFinite(spent) ? Math.max(5, Math.round(est - spent)) : est;
  }
  return est;
}
var MAX_DATE = 864e13;
var PACE_MIN = 0.25;
var PACE_MAX = 4;
var clampPace = (r2) => Number.isFinite(r2) && r2 > 0 ? Math.min(PACE_MAX, Math.max(PACE_MIN, r2)) : 1;
function paceRatioOf(plan, states) {
  const ratios = [];
  for (const t of plan.tasks) {
    const s = states[t.id];
    const est = Number(t.estimate_min);
    if (s?.status !== "done" || !s.startedAt || !s.doneAt || !(est > 0)) continue;
    const real = (Date.parse(s.doneAt) - Date.parse(s.startedAt)) / MIN2;
    if (Number.isFinite(real) && real > 0) ratios.push(real / est);
  }
  if (!ratios.length) return 1;
  ratios.sort((a, b) => a - b);
  const mid = ratios.length >> 1;
  return clampPace(ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2);
}
function maxOf(values) {
  let max = 0;
  for (const v of values) if (v > max) max = v;
  return max;
}
function forecastEnd(plan, states, now, opts) {
  const pending = plan.tasks.filter((t) => !isDone(states, t.id));
  if (!pending.length) return null;
  const parallel = Math.max(1, Math.floor(Number.isFinite(opts.parallel) ? opts.parallel : 1));
  const pace = clampPace(opts.paceRatio);
  const ids = new Set(pending.map((t) => t.id));
  const dur = new Map(pending.map((t) => [t.id, remainingMin(plan, states, t.id, now) * pace]));
  const deps = new Map(pending.map((t) => [t.id, [...new Set(t.depends_on)].filter((x2) => ids.has(x2) && x2 !== t.id)]));
  const waiting = /* @__PURE__ */ new Map();
  for (const [id, ds] of deps) for (const x2 of ds) waiting.set(x2, [...waiting.get(x2) ?? [], id]);
  const tail = /* @__PURE__ */ new Map();
  const visiting = /* @__PURE__ */ new Set();
  const tailOf = (id) => {
    const known = tail.get(id);
    if (known !== void 0) return known;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    let best = 0;
    for (const next of waiting.get(id) ?? []) best = Math.max(best, tailOf(next));
    visiting.delete(id);
    const v = best + dur.get(id);
    tail.set(id, v);
    return v;
  };
  const running = (id) => {
    const s = states[id]?.status;
    return s === "in_progress" || s === "claimed";
  };
  const rank = (a, b) => Number(running(b)) - Number(running(a)) || tailOf(b) - tailOf(a) || (a < b ? -1 : a > b ? 1 : 0);
  const free = Array.from({ length: Math.min(parallel, pending.length) }, () => 0);
  const finish = /* @__PURE__ */ new Map();
  const left = new Set(ids);
  while (left.size) {
    let ready = [...left].filter((id2) => deps.get(id2).every((x2) => finish.has(x2)));
    if (!ready.length) ready = [...left];
    ready.sort(rank);
    const id = ready[0];
    const after = Math.max(0, ...deps.get(id).map((x2) => finish.get(x2) ?? 0));
    let w = 0;
    for (let i = 1; i < free.length; i++) if (Math.max(free[i], after) < Math.max(free[w], after)) w = i;
    const end = Math.max(free[w], after) + dur.get(id);
    free[w] = end;
    finish.set(id, end);
    left.delete(id);
  }
  const at2 = now + maxOf(finish.values()) * MIN2;
  return Number.isFinite(at2) && Math.abs(at2) <= MAX_DATE ? { at: Math.round(at2), parallel } : null;
}

// src/lib/worktree.ts
var import_node_path5 = __toESM(require("node:path"), 1);

// src/lib/main-checkout.ts
function mainCheckoutFrom(root, gitFileText) {
  const m = gitFileText ? /^gitdir:\s*(.+?)[\\/]\.git[\\/]worktrees[\\/][^\\/\r\n]+\s*$/m.exec(gitFileText) : null;
  const dir = m ? m[1] : null;
  return dir && (/^[A-Za-z]:/.test(dir) || dir.startsWith("/")) ? dir : root;
}

// src/lib/worktree.ts
function mainWorktreeFrom(porcelain) {
  if (typeof porcelain !== "string") return null;
  const line3 = porcelain.split(/\r?\n/).find((l3) => l3.startsWith("worktree "));
  return line3 ? line3.slice("worktree ".length).trim() || null : null;
}
function samePath(a, b) {
  const norm3 = (p) => {
    const r2 = import_node_path5.default.resolve(p.replace(/\\/g, "/"));
    return process.platform === "win32" ? r2.toLowerCase() : r2;
  };
  return norm3(a) === norm3(b);
}
var BRANCH_RE = /^[A-Za-z0-9_.\/~:@+][A-Za-z0-9_\-.\/~:@+]{0,199}$/;

// src/lib/git-info.ts
var import_node_fs5 = require("node:fs");
var import_node_path6 = __toESM(require("node:path"), 1);
var hasLine = (text, line3) => text.split(/\r?\n/).some((l3) => l3.trim() === line3);
function appendOnce(file, line3) {
  let text = "";
  try {
    text = (0, import_node_fs5.readFileSync)(file, "utf8");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  if (hasLine(text, line3)) return;
  (0, import_node_fs5.appendFileSync)(file, `${text && !text.endsWith("\n") ? "\n" : ""}${line3}
`);
}
var gitToplevel = (git) => git(["rev-parse", "--show-toplevel"])?.trim() || null;
function commonDir(git) {
  const holdsHead = (d) => (0, import_node_fs5.existsSync)(import_node_path6.default.join(d, "HEAD"));
  const lines2 = (s) => (s ?? "").split(/\r?\n/).map((l3) => l3.trim()).filter(Boolean);
  const first = lines2(git(["rev-parse", "--path-format=absolute", "--git-common-dir"]));
  if (first.length === 1 && import_node_path6.default.isAbsolute(first[0]) && holdsHead(first[0])) return import_node_path6.default.resolve(first[0]);
  const top = gitToplevel(git);
  const rel = top ? lines2(git(["-C", top, "rev-parse", "--git-common-dir"])) : [];
  const dir = top && rel.length === 1 ? import_node_path6.default.resolve(top, rel[0]) : null;
  return dir && holdsHead(dir) ? dir : null;
}
function infoFile(git, name) {
  const dir = commonDir(git);
  if (!dir) return null;
  const info = import_node_path6.default.join(dir, "info");
  if (!(0, import_node_fs5.existsSync)(info)) (0, import_node_fs5.mkdirSync)(info);
  return import_node_path6.default.join(info, name);
}
var WORKTREES_DIR = ".claude/worktrees/";
function excludeWorktrees(git) {
  try {
    if (git(["check-ignore", "-q", WORKTREES_DIR]) !== null) return;
    const file = infoFile(git, "exclude");
    if (file) appendOnce(file, WORKTREES_DIR);
  } catch {
  }
}

// src/cli/hooks.ts
var import_node_fs7 = require("node:fs");
var import_node_path8 = __toESM(require("node:path"), 1);
var import_node_child_process3 = require("node:child_process");
var import_node_crypto2 = require("node:crypto");

// src/lib/locale.ts
var import_node_fs6 = require("node:fs");
var import_node_path7 = __toESM(require("node:path"), 1);
var import_yaml4 = __toESM(require_dist(), 1);
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
function replyIn(locale, source = "plan") {
  const code = (locale ?? "").toLowerCase().split(/[-_]/)[0];
  if (!code) return " Tell the user in their own language.";
  const name = NAMES[code];
  if (source === "person") return ` Tell the user in ${name ? `${name} (${code})` : `\xAB${code}\xBB`}, the language they write in.`;
  return ` Tell the user in ${name ? `${name} (${code})` : `the language \xAB${code}\xBB`}, the plan's language.`;
}
function planLocale(root, project) {
  try {
    const docs = import_node_path7.default.join(root, "docs", "waypoint");
    const projects = project ? [project] : (0, import_node_fs6.readdirSync)(docs, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    for (const p of projects) {
      const file = import_node_path7.default.join(docs, p, "plan.yaml");
      if (!(0, import_node_fs6.existsSync)(file)) continue;
      const raw = (0, import_yaml4.parse)((0, import_node_fs6.readFileSync)(file, "utf8"));
      const locale = raw && typeof raw === "object" && !Array.isArray(raw) ? raw.locale : null;
      return isLocale(locale) ? locale : null;
    }
  } catch {
  }
  return null;
}

// src/lib/member-doc.ts
var isMemberId = (s) => isSafeId(s);
var MEMBERS_MAX = 50;
function newestMemberFiles(files) {
  return files.filter((f) => f.name.endsWith(".json") && isMemberId(f.name.slice(0, -5)) && f.size <= FORGE_DOC_MAX_BYTES).sort((a, b) => b.mtimeMs - a.mtimeMs || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).slice(0, MEMBERS_MAX);
}
function normalizeMember(x2) {
  if (!x2 || typeof x2 !== "object" || Array.isArray(x2)) return null;
  const o = x2;
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

// src/lib/project-pick.ts
function pickProject(entries2, sessionId) {
  if (!entries2.length) return null;
  const time3 = (s) => {
    const t = s ? Date.parse(s) : NaN;
    return Number.isFinite(t) ? t : -Infinity;
  };
  const at2 = (b) => Math.max(time3(b.seenAt), time3(b.endedAt));
  const activity = (e) => Math.max(e.mtimeMs, ...e.bindings.map(at2));
  const ownAt = (e) => Math.max(-Infinity, ...e.bindings.filter((b) => b.claude === sessionId).map(at2));
  const own = sessionId ? entries2.filter((e) => ownAt(e) > -Infinity) : [];
  const score = (e) => own.length ? [ownAt(e), activity(e)] : [activity(e)];
  const better = (a, b) => {
    const sa = score(a), sb = score(b);
    for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sb[i] > sa[i] ? 1 : -1;
    return 0;
  };
  return [...own.length ? own : entries2].sort(better)[0].name;
}

// src/cli/hooks.ts
var SOURCES = ["startup", "resume", "clear", "compact", "fork"];
var RENEW_MS = 6e4;
var MAX_COMMITS = 20;
var SHA3 = /^[0-9a-f]{7,64}$/;
var COMMIT_RE = /(^|[;&|(]\s*|\s)git\s+((-c|-C)\s+\S+\s+|--no-pager\s+)*commit(?![\w-])/;
function isCommitCommand(cmd) {
  return COMMIT_RE.test(cmd) && !/(^|\s)--dry-run(?![\w-])/.test(cmd);
}
var MAKES_RE = /(^|[;&|(]\s*|\s)git\s+((-c|-C)\s+\S+\s+|--no-pager\s+)*(merge|cherry-pick|revert|am)(?![\w-])/;
var CONTINUE_RE = /(^|[;&|(]\s*|\s)git\s+((-c|-C)\s+\S+\s+|--no-pager\s+)*rebase\s+(-\S+\s+)*--continue(?![\w-])/;
function makesCommits(cmd) {
  return isCommitCommand(cmd) || MAKES_RE.test(cmd) || CONTINUE_RE.test(cmd);
}
var nonEmpty = (v) => typeof v === "string" && v.trim() ? v : void 0;
var read = (f) => {
  try {
    return (0, import_node_fs7.readFileSync)(f, "utf8");
  } catch {
    return null;
  }
};
var readCapped = (f, max) => {
  try {
    return (0, import_node_fs7.statSync)(f).size > max ? null : (0, import_node_fs7.readFileSync)(f, "utf8");
  } catch {
    return null;
  }
};
var lines = (file) => (read(file) ?? "").split("\n").filter((l3) => l3.trim());
var field = (l3, k2) => {
  try {
    const o = JSON.parse(l3);
    const v = o?.[k2];
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
};
var rootOf = (io, input) => nonEmpty(io.env?.CLAUDE_PROJECT_DIR) ?? nonEmpty(input.cwd) ?? io.cwd;
var projectDirs = (root) => {
  try {
    return (0, import_node_fs7.readdirSync)(import_node_path8.default.join(root, ".waypoint"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).slice(0, MAX_PROJECTS);
  } catch {
    return [];
  }
};
function readForge(root, project, now) {
  const main = mainCheckoutFrom(root, read(import_node_path8.default.join(root, ".git")));
  const dir = import_node_path8.default.join(main, ".forge");
  const any = parseExecution(read(import_node_path8.default.join(dir, "execution.json")), now);
  const exec = any && (any.kind === "ephemeral" || any.project === project) ? any : null;
  const mdir = import_node_path8.default.join(dir, "members");
  let files = [];
  try {
    files = (0, import_node_fs7.readdirSync)(mdir, { withFileTypes: true }).filter((d) => d.isFile() && d.name.endsWith(".json")).flatMap((d) => {
      try {
        const st2 = (0, import_node_fs7.statSync)(import_node_path8.default.join(mdir, d.name));
        return [{ name: d.name, size: st2.size, mtimeMs: st2.mtimeMs }];
      } catch {
        return [];
      }
    });
  } catch {
    files = [];
  }
  const members = newestMemberFiles(files).flatMap((f) => {
    try {
      const m = normalizeMember(JSON.parse(read(import_node_path8.default.join(mdir, f.name)) ?? "null"));
      return m ? [m] : [];
    } catch {
      return [];
    }
  });
  let signal = null;
  if (exec && isSafeId(exec.hookSession)) {
    try {
      signal = normalizeLive(JSON.parse(readCapped(import_node_path8.default.join(dir, "live", `${exec.hookSession}.json`), FORGE_DOC_MAX_BYTES) ?? "null"));
    } catch {
      signal = null;
    }
  }
  const bindings = exec?.active && isSafeId(exec.hookSession) ? claudeBindings(main, exec.hookSession, now) : [];
  return { exec, any, members, infinite: parseRun(read(import_node_path8.default.join(dir, "run.json"))), coordinatorEnded: coordinatorGone(exec, signal, now, { bindings }) };
}
var NOBODY = { role: "none", subject: null, binding: null, member: null, coordinator: false, since: null, task: null };
function contextOf(io, input) {
  const root = rootOf(io, input);
  const now = io.now().getTime();
  const sid = isSafeId(input.session_id) ? input.session_id : null;
  const base = import_node_path8.default.join(root, "docs", "waypoint");
  if (!(0, import_node_fs7.existsSync)(base)) return null;
  const seatsOf = /* @__PURE__ */ new Map();
  const entries2 = (0, import_node_fs7.readdirSync)(base, { withFileTypes: true }).filter((d) => d.isDirectory()).flatMap((d) => {
    const files = ["plan.yaml", "design.md"].map((n) => import_node_path8.default.join(base, d.name, n)).filter((f) => (0, import_node_fs7.existsSync)(f));
    if (!files.length) return [];
    const seats2 = readSeats(import_node_path8.default.join(root, ".waypoint", d.name), now).map((s) => s.bound ? { ...s, bound: settleBinding(s.bound, now) } : s);
    seatsOf.set(d.name, seats2);
    return [{ name: d.name, bindings: seats2.flatMap((s) => s.bound ? [s.bound] : []), mtimeMs: Math.max(...files.map((f) => (0, import_node_fs7.statSync)(f).mtimeMs)) }];
  });
  const project = pickProject(entries2, sid);
  if (!project) return null;
  const wp = import_node_path8.default.join(root, ".waypoint", project);
  const seats = seatsOf.get(project) ?? [];
  const forge = readForge(root, project, now);
  const run2 = forge.exec;
  const viewer = sid === null ? NOBODY : describeViewer({
    bound: seats.flatMap((s) => s.bound ? [s.bound] : []),
    execution: run2,
    members: run2 ? forge.members.filter((m) => m.runId === run2.runId) : [],
    sessionId: sid,
    now,
    coordinatorEnded: forge.coordinatorEnded,
    openTasks: openTasksOf(wp)
  });
  return { root, project, wp, docDir: import_node_path8.default.join(base, project), now, sid, seats, viewer, forge };
}
function ownSeat(ctx) {
  const v = ctx.viewer;
  const b = v.role === "owner" && v.subject === "binding" ? v.binding : null;
  const seat = b ? ctx.seats.find((s) => s.sid === b.sid) : void 0;
  return b && seat ? { seat, bound: b } : null;
}
function touch(seat, claude, now, reopen, env) {
  try {
    const cur = parseBound(read(boundFile(seat.dir)), now.getTime());
    if (!cur || cur.sid !== seat.sid || cur.claude !== claude) return;
    const again = reopen && cur.endReason !== "released";
    if (!again && (cur.endedAt !== null || now.getTime() - Date.parse(cur.seenAt) < RENEW_MS)) return;
    writeBinding(boundFile(seat.dir), { ...cur, seenAt: now.toISOString(), ...again ? { endedAt: null, endReason: null, pid: pidFromEnv(env) } : {} });
  } catch {
  }
}
function renewOwn(ctx, io, reopen) {
  const sid = ctx.sid;
  if (!sid) return;
  const newestOf = (list) => list.reduce((best, s) => !best || Date.parse(s.bound.seenAt) > Date.parse(best.bound.seenAt) ? s : best, null);
  const mine = ctx.seats.filter((s) => s.bound?.claude === sid);
  const newest2 = newestOf(mine);
  const again = reopen && newest2 !== null && newest2.bound.endReason !== "released";
  const target = again ? newest2 : newestOf(mine.filter((s) => s.bound.endedAt === null));
  if (target) touch(target, sid, io.now(), again, io.env);
}
function readPlan(docDir) {
  try {
    return parsePlan((0, import_node_fs7.readFileSync)(import_node_path8.default.join(docDir, "plan.yaml"), "utf8"));
  } catch {
    return null;
  }
}
function draftVersion(docDir) {
  try {
    if (parseDesign((0, import_node_fs7.readFileSync)(import_node_path8.default.join(docDir, "design.md"), "utf8")).meta.status !== "draft") return null;
    const log = parseChangelog(read(import_node_path8.default.join(docDir, "design", "changelog.json")));
    return log[log.length - 1]?.version ?? 0;
  } catch {
    return null;
  }
}
var agoText = (ms) => ms < 6e4 ? "just now" : ms < 36e5 ? `${Math.floor(ms / 6e4)} min ago` : `${Math.floor(ms / 36e5)} h ago`;
var ENDED = {
  clear: "ended by /clear",
  resume: "ended when another conversation was resumed",
  prompt_input_exit: "ended on exit",
  logout: "ended on logout",
  other: "ended",
  released: "released"
};
function whenText(b, now) {
  const ago = agoText(Math.max(0, now - Date.parse(b.endedAt ?? b.seenAt)));
  return b.endedAt !== null && b.endReason !== null ? `${ENDED[b.endReason]} ${ago}` : `last seen ${ago}`;
}
function ownerText(ctx, own, plan, source, input) {
  if (own.bound.via === "design") {
    const v = draftVersion(ctx.docDir);
    return v === null ? null : `waypoint: design document ${ctx.project} v${v} (draft). Use /waypoint:design to continue the design loop.`;
  }
  if (!plan) return null;
  const sid = own.bound.sid;
  if (own.bound.via === "forge-infinite" || own.bound.via === "forge-run" && !ctx.viewer.task) {
    return `waypoint: this conversation holds seat ${sid} of project ${ctx.project} (${plan.artifacts.roadmap ?? "not published"}) for its forge ${own.bound.via === "forge-infinite" ? "infinite run" : "run"}.`;
  }
  let track = "-";
  try {
    const s = JSON.parse(read(import_node_path8.default.join(own.seat.dir, "session.json")) ?? "{}");
    if (typeof s?.track === "string" && s.track) track = s.track;
  } catch {
    track = "-";
  }
  const cur = ctx.viewer.task ? plan.tasks.find((t) => t.id === ctx.viewer.task) : void 0;
  const open = Object.values(readDocs(import_node_path8.default.join(ctx.wp, "dbcache", "messages"), normalizeMessage).docs).filter((m) => m.to === sid && m.status === "open").length;
  const secs = typeof input.seconds_since_last_response === "number" ? input.seconds_since_last_response : 0;
  const resumed = source === "resume" && secs >= 3600 ? `Resumed after ${Math.floor(secs / 3600)} h. ` : "";
  return `${resumed}waypoint: project ${ctx.project} has a live roadmap (${plan.artifacts.roadmap ?? "not published"}). Session ${sid} track ${track}. Current task: ${cur ? `${cur.id} ${cur.title}` : "none"}. Open messages: ${open}. Use /waypoint:work to continue, /waypoint:status for progress.`;
}
function sessionStart(io, input) {
  const ctx = contextOf(io, input);
  if (!ctx) return "";
  const source = SOURCES.includes(input.source) ? input.source : "startup";
  const say = (text) => text ? JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text } }) : "";
  const v = ctx.viewer;
  renewOwn(ctx, io, source === "resume" || source === "compact");
  if (v.subject === "execution") return "";
  const plan = readPlan(ctx.docDir);
  const url = plan?.artifacts.roadmap ?? "not published";
  const title = (t) => plan?.tasks.find((x2) => x2.id === t)?.title ?? "";
  const own = ownSeat(ctx);
  if (own && ctx.sid) {
    recordBase(own.seat.dir, ctx.sid, nonEmpty(input.cwd) ?? ctx.root);
    return say(ownerText(ctx, own, plan, source, input));
  }
  const b = v.binding;
  if (v.role === "other-live" && b) {
    if (!plan) return "";
    const seen = Math.max(0, Math.round((ctx.now - Date.parse(b.seenAt)) / 6e4));
    const works = v.task ? ` and works on ${v.task} "${title(v.task)}"` : "";
    const fork = source === "fork" ? " This conversation is a fork; the binding stays with the original session." : "";
    return say(`waypoint: project ${ctx.project} has a live roadmap (${url}). Another session (seat ${b.sid}, seen ${seen} min ago) is bound to it${works}. This session is not bound to the roadmap.${fork}`);
  }
  if (v.role === "previous" && b) {
    const when = whenText(b, ctx.now);
    if (b.via === "design") {
      const ver = draftVersion(ctx.docDir);
      if (ver !== null) return say(`waypoint: design document ${ctx.project} v${ver} (draft) was being worked by an earlier conversation (${when}). This session is not bound to it; /waypoint:design takes it up if the user asks.`);
    } else if (v.task && plan) {
      return say(`waypoint: ${v.task} "${title(v.task)}" of project ${ctx.project} was left in progress by an earlier conversation (seat ${b.sid}, ${when}). This session is not bound to the roadmap. If the user asks to take it up, /waypoint:work resume binds this session to it; otherwise it stays as it is.`);
    }
  }
  return say(source === "startup" && plan ? `waypoint: project ${ctx.project} has a roadmap (${url}); no session is bound to it.` : null);
}
function sessionEnd(root, sid, reason, now) {
  const at2 = now.toISOString();
  for (const n of projectDirs(root)) {
    for (const s of readSeats(import_node_path8.default.join(root, ".waypoint", n), now.getTime())) {
      if (!s.bound || s.bound.claude !== sid || s.bound.endedAt !== null) continue;
      const cur = readBinding(s.dir, s.sid, now.getTime());
      if (cur && cur.claude === sid && cur.endedAt === null) writeBinding(boundFile(s.dir), { ...cur, endedAt: at2, endReason: endReasonOf(reason) });
    }
  }
  return "";
}
function boundAnywhere(root, sid) {
  return projectDirs(root).some((n) => readSeats(import_node_path8.default.join(root, ".waypoint", n)).some((s) => s.bound?.claude === sid));
}
function othersOn(ctx, own, top, head) {
  let live = false;
  const seen = /* @__PURE__ */ new Set();
  for (const s of ctx.seats) {
    const b = s.bound;
    if (s === own || !b || b.claude === ctx.sid) continue;
    const lh = readLastHead(s.dir);
    if (!lh || lh.session !== b.claude) continue;
    const base = lh.heads[top];
    const recorded = lh.recorded?.[top] ?? [];
    if (base && bindingLive(b, ctx.now)) live = true;
    for (const r2 of recorded) seen.add(r2);
    if (base && (base !== head || recorded.includes(head))) seen.add(base);
  }
  return { live, seen };
}
function ownShare(range, seen) {
  const k2 = range.reduce((at2, s, i) => seen.has(s) ? i : at2, -1);
  if (k2 < 0) return range;
  return k2 < range.length - 1 ? range.slice(k2 + 1) : range.filter((s) => !seen.has(s));
}
function postCommit(io, input) {
  const ctx = contextOf(io, input);
  if (ctx) renewOwn(ctx, io, false);
  const own = ctx ? ownSeat(ctx) : null;
  if (!ctx || !own || !ctx.sid) return "";
  const sid = ctx.sid;
  const at2 = headOf(nonEmpty(input.cwd) ?? ctx.root);
  if (!at2) return "";
  const lh = readLastHead(own.seat.dir);
  const mine = lh && lh.session === sid ? lh : null;
  const heads = mine?.heads ?? {};
  const recorded = mine?.recorded ?? {};
  const last = heads[at2.top];
  let newest2 = null;
  const save = () => {
    if (last === at2.head && !newest2) return;
    writeLastHead(own.seat.dir, { session: sid, heads: { ...heads, [at2.top]: at2.head }, recorded: newest2 ? { ...recorded, [at2.top]: [...recorded[at2.top] ?? [], newest2] } : recorded });
  };
  const task = ctx.viewer.task;
  if (!task) {
    save();
    return "";
  }
  const file = import_node_path8.default.join(own.seat.dir, "pending-commits.jsonl");
  const cmd = typeof input.tool_input?.command === "string" ? input.tool_input.command : "";
  const git = (args) => {
    try {
      return (0, import_node_child_process3.execFileSync)("git", ["-C", at2.top, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      return null;
    }
  };
  let shas = [];
  if (!last) shas = isCommitCommand(cmd) ? [at2.head] : [];
  else if (last !== at2.head) {
    const others = othersOn(ctx, own.seat, at2.top, at2.head);
    if (!others.live || makesCommits(cmd)) {
      const range = (git(["rev-list", "--first-parent", "--reverse", `--max-count=${MAX_COMMITS}`, `${last}..${at2.head}`]) ?? "").split(/\r?\n/).map((s) => s.trim()).filter((s) => SHA3.test(s));
      shas = ownShare(range, others.seen);
    }
    if (git(["merge-base", "--is-ancestor", last, at2.head]) === null) {
      const all = lines(file);
      let checked = 0;
      const kept = all.filter((l3) => {
        const s = field(l3, "sha");
        if (!s || checked >= MAX_COMMITS) return true;
        checked++;
        return git(["merge-base", "--is-ancestor", s, at2.head]) !== null;
      });
      if (kept.length !== all.length) (0, import_node_fs7.writeFileSync)(file, kept.map((l3) => `${l3}
`).join(""));
    }
  }
  const have = new Set(lines(file).map((l3) => field(l3, "sha")));
  const ts = io.now().toISOString();
  const fresh = shas.filter((s) => !have.has(s));
  if (fresh.length) {
    (0, import_node_fs7.appendFileSync)(file, fresh.map((sha) => `${JSON.stringify({ ts, task, sha, command: cmd.slice(0, 200), session: sid, seat: own.bound.sid })}
`).join(""));
    newest2 = fresh[fresh.length - 1];
  }
  save();
  return "";
}
function stop(io, input) {
  const ctx = contextOf(io, input);
  if (ctx) renewOwn(ctx, io, false);
  const own = ctx ? ownSeat(ctx) : null;
  if (!ctx || !own || !ctx.sid) return "";
  if (forgeRoleOf({ execution: ctx.forge.any, members: ctx.forge.members, infinite: ctx.forge.infinite }, ctx.sid) !== null) return "";
  const ongoing = ctx.viewer.task;
  const commits = lines(import_node_path8.default.join(own.seat.dir, "pending-commits.jsonl")).filter((l3) => ongoing === null || field(l3, "task") !== ongoing);
  const queued = lines(import_node_path8.default.join(own.seat.dir, "queue.jsonl"));
  if (!commits.length && !queued.length) return "";
  const hash = (0, import_node_crypto2.createHash)("sha256").update(JSON.stringify([commits, queued])).digest("hex");
  const ackFile = import_node_path8.default.join(own.seat.dir, "stop-ack");
  if ((read(ackFile) ?? "").trim() === hash) return "";
  (0, import_node_fs7.writeFileSync)(ackFile, `${hash}
`);
  const rel = import_node_path8.default.relative(ctx.root, own.seat.dir).split(import_node_path8.default.sep).join("/");
  const count = new Set(commits.map((l3) => field(l3, "sha") ?? l3)).size;
  return JSON.stringify({ decision: "block", reason: `waypoint: ${count} commit(s) / ${queued.length} queued roadmap update(s) are not in the live roadmap yet. Record them (work skill: a \`commit\` event for intermediate commits, or the task's completion), or flush the queue, then remove those lines from ${rel}/pending-commits.jsonl. You can also stop now; this reminder shows once per change.${replyIn(planLocale(ctx.root, ctx.project))}` });
}
function runHook(sub, io) {
  let input;
  try {
    const v = JSON.parse(io.stdin ?? "");
    if (!v || typeof v !== "object" || Array.isArray(v)) return "";
    input = v;
  } catch {
    return "";
  }
  const sid = isSafeId(input.session_id) ? input.session_id : null;
  switch (sub) {
    case "session-start":
      return sessionStart(io, input);
    case "session-end":
      return sid ? sessionEnd(rootOf(io, input), sid, input.reason, io.now()) : "";
    // A session bound nowhere in this checkout is nobody's owner: it leaves before reading forge or the state cache.
    case "post-commit":
      return sid && boundAnywhere(rootOf(io, input), sid) ? postCommit(io, input) : "";
    case "stop":
      return input.stop_hook_active === true || !sid || !boundAnywhere(rootOf(io, input), sid) ? "" : stop(io, input);
    default:
      return "";
  }
}

// src/lib/launcher.ts
var PLAN_PATH = /^[\w./\\:~@+ -]+$/;
var quote = (s) => `'${s.split("'").join(`'\\''`)}'`;
function launchCommand(x2) {
  return `claude --bg --name ${x2.name}${x2.effort ? ` --effort ${x2.effort}` : ""}${x2.model ? ` --model ${x2.model}` : ""} "${x2.prompt}"`;
}
function launchRun(x2) {
  return `(cd ${quote(x2.worktree)} && ${launchCommand(x2)})`;
}

// src/lib/publish.ts
var PAGE_RULES = 2;
function roadmapCapabilities(assets) {
  return {
    db: { rules: [
      { path: "", read: "view", write: "admin" },
      { path: "notes", read: "view", write: "interact" },
      { path: "proposals", read: "view", write: "interact" },
      // §4.1: only the roadmap's owner writes the mark that makes a decision count for forge (not admin: editors comment).
      { path: "approvals", read: "view", write: "owner" }
    ] },
    user: { scopes: ["profile"] },
    downloads: true,
    ...assets ? { assets: {} } : {}
  };
}
function rulesOf(capabilities) {
  const field2 = (x2, key) => x2 && typeof x2 === "object" && !Array.isArray(x2) ? x2[key] : void 0;
  const rules = field2(field2(capabilities, "db"), "rules");
  const onApprovals = Array.isArray(rules) ? rules.filter((r2) => field2(r2, "path") === "approvals") : [];
  const owner = onApprovals.length > 0 && onApprovals.every((r2) => field2(r2, "read") === "view" && field2(r2, "write") === "owner");
  return owner ? PAGE_RULES : 1;
}
var declaresAssets = (capabilities) => !!capabilities && typeof capabilities === "object" && !Array.isArray(capabilities) && Object.hasOwn(capabilities, "assets");
function sharingChanged(plan, assets, published) {
  if (!plan.artifacts.roadmap) return false;
  return published === void 0 ? assets : published !== assets;
}
function sharingChangeAsk(plan, assets) {
  if (assets) {
    return isEs(plan.locale) ? "Al republicar, el roadmap pasa a guardar las capturas de verificaci\xF3n de forge: quedar\xE1 interno de tu organizaci\xF3n y su enlace p\xFAblico dejar\xE1 de funcionar." : "Republishing makes the roadmap keep forge's verification screenshots: it becomes internal to your organization and its public link stops working.";
  }
  return isEs(plan.locale) ? "Al republicar, el roadmap deja de guardar las capturas de verificaci\xF3n de forge (evidence: local en .forge/config.yaml): podr\xE1 volver a compartirse p\xFAblicamente y las capturas ya subidas dejar\xE1n de verse." : "Republishing stops the roadmap keeping forge's verification screenshots (evidence: local in .forge/config.yaml): it can be shared publicly again, and the screenshots already uploaded stop showing.";
}
var isEs = (locale) => (locale ?? "").toLowerCase().split(/[-_]/)[0] === "es";
function sharingNotice(plan, internal) {
  if (!internal || plan.artifacts.roadmap) return null;
  return isEs(plan.locale) ? "El roadmap lleva las capturas de verificaci\xF3n de forge, as\xED que queda interno de tu organizaci\xF3n y no se puede compartir p\xFAblicamente (con evidence: local en .forge/config.yaml no se suben)." : "The roadmap carries forge's verification screenshots, so it stays internal to your organization and cannot be shared publicly (with evidence: local in .forge/config.yaml they are not uploaded).";
}
function syncSummary(plan) {
  const url = plan.artifacts.roadmap;
  if (!url) return null;
  const n = (count, one, many) => `${count} ${count === 1 ? one : many}`;
  return isEs(plan.locale) ? `Roadmap: ${url} \xB7 ${n(plan.tasks.length, "tarea", "tareas")}, ${n(plan.phases.length, "fase", "fases")}, ${n(plan.tracks.length, "frente", "frentes")}.` : `Roadmap: ${url} \xB7 ${n(plan.tasks.length, "task", "tasks")}, ${n(plan.phases.length, "phase", "phases")}, ${n(plan.tracks.length, "track", "tracks")}.`;
}

// src/lib/claude-session.ts
function claudeSessionId(flag, env = process.env) {
  if (isSafeId(flag) && !flag.startsWith("-")) return flag;
  const v = env.CLAUDE_CODE_SESSION_ID;
  return isSafeId(v) ? v : null;
}
var noClaudeSession = (cmd, flagName) => `${cmd}: no Claude session id: pass ${flagName} <id> or run it from Claude Code (CLAUDE_CODE_SESSION_ID)`;

// src/cli/run.ts
var nodeSpawn = (command, options) => (0, import_node_child_process4.spawn)(command, options);
var USAGE = `usage: waypoint <validate|hash|clean-cache|page|sync|doctor|next|conflicts|recover|notes|inbox|escalations|launch|status|session-id|event-id|now|commit-info|claim|done|block|heartbeat|bind|release|design-validate|design-park|design-import|design-snapshot|design-changed|design-gate|design-impact|critique-next|critique-check|critique-select|critique-dismiss|design-page|hook> ...`;
function run(argv, io) {
  const [cmd, ...args] = argv;
  const flag = (name) => {
    const i = args.indexOf(`--${name}`);
    const v = i >= 0 ? args[i + 1] : void 0;
    return v === void 0 || v.startsWith("--") ? void 0 : v;
  };
  const abs = (p) => import_node_path9.default.resolve(io.cwd, p);
  const warnings = [];
  const ok = (stdout, stderr = warnings.join("")) => ({ code: 0, stdout: stdout.endsWith("\n") ? stdout : `${stdout}
`, stderr });
  const fail = (stderr, code = 1) => ({ code, stdout: "", stderr: `${warnings.join("")}${stderr}
` });
  const loadPlan = () => parsePlan((0, import_node_fs8.readFileSync)(abs(args[0]), "utf8"));
  const docsIn = (dir, normalize) => {
    if (!dir) return {};
    const r2 = readDocs(abs(dir), normalize);
    for (const f of r2.skipped) warnings.push(`warning: skipped ${dir.replace(/[\\/]+$/, "")}/${f} (unreadable)
`);
    return r2.docs;
  };
  const docs = (name, normalize) => docsIn(flag(name), normalize);
  const optStates = () => {
    if (flag("states") && !(0, import_node_fs8.existsSync)(abs(flag("states")))) throw new CacheError(`${cmd}: --states cache missing \u2014 list it first`);
    return docs("states", stateDoc);
  };
  const optSessions = () => {
    if (!flag("sessions")) return void 0;
    if (!(0, import_node_fs8.existsSync)(abs(flag("sessions")))) throw new CacheError(`${cmd}: --sessions cache missing \u2014 list it first`);
    return docs("sessions", sessionDoc);
  };
  const loadView = () => {
    const p = loadPlan();
    const db = flag("db");
    if (!db) return { view: p, project: p.project, version: p.version };
    const metaFile = import_node_path9.default.join(abs(db), "meta", "project.json");
    const phases = Object.values(docsIn(import_node_path9.default.join(abs(db), "plan"))).map((d) => normalizePhase(d)).filter((x2) => !!x2);
    const meta = (0, import_node_fs8.existsSync)(metaFile) ? normalizeMeta(JSON.parse((0, import_node_fs8.readFileSync)(metaFile, "utf8"))) : null;
    if (!meta || !phases.length) throw new CacheError("db plan cache missing \u2014 list meta and plan first");
    return { view: planViewFromDocs(meta, phases), project: p.project, version: meta.version || p.version };
  };
  const out = (code, value) => ({ code, stdout: `${JSON.stringify(value)}
`, stderr: warnings.join("") });
  const posInt = (name) => {
    const v = flag(name);
    return v !== void 0 && /^[1-9]\d{0,9}$/.test(v) ? Number(v) : null;
  };
  const SID_RE = /^[A-Za-z0-9_.~:@+][A-Za-z0-9_\-.~:@+]{0,79}$/;
  const taskFlags = (cmd2, versions) => {
    const sid = flag("session"), task = flag("task");
    if (!sid || !SID_RE.test(sid)) return fail(`${cmd2}: --session needs the session id`, 2);
    if (!task || task.startsWith("--") || !isPlanId(task)) return fail(`${cmd2}: --task needs a plan task id`, 2);
    const db = flag("db");
    if (args.includes("--db") && (!db || db.startsWith("-"))) return fail(`${cmd2}: --db needs the cache directory`, 2);
    const v = {};
    for (const name of versions) {
      const n = posInt(name);
      if (n === null) return fail(`${cmd2}: --${name} must be a positive integer`, 2);
      v[name] = n;
    }
    return { sid, task, v };
  };
  const readDesignArg = (cmd2, arg) => {
    let text;
    try {
      text = (0, import_node_fs8.readFileSync)(abs(arg), "utf8");
    } catch (e) {
      return fail(`${cmd2}: cannot read the design ${arg}: ${e.message}`, 2);
    }
    try {
      return parseDesign(text);
    } catch (e) {
      return fail(`${cmd2}: ${arg} is not a design: ${e.message}`, 2);
    }
  };
  const planHas = (task) => loadView().view.tasks.some((t) => t.id === task);
  const mirror = (batch) => {
    const db = flag("db");
    if (db) for (const w of batch) mirrorState(abs(db), w);
  };
  try {
    switch (cmd) {
      case "validate": {
        const p = loadPlan();
        const loose = p.tasks.filter((t) => !t.zones.length).map((t) => t.id);
        const warning = loose.length ? `
warning: ${loose.length} task(s) without zones run alone in a forge execution: ${loose.join(", ")}` : "";
        let refs = "";
        const designArg = flag("design");
        if (args.includes("--design") && (!designArg || designArg.startsWith("--"))) return fail("validate: --design needs the design file", 2);
        if (designArg) {
          const design = readDesignArg("validate", designArg);
          if ("code" in design) return design;
          const slugs = /* @__PURE__ */ new Set(["_intro", ...design.sections.map((s) => s.slug)]);
          const unknown = p.tasks.filter((t) => t.design_ref && !slugs.has(t.design_ref)).map((t) => `${t.id} (${t.design_ref})`);
          if (unknown.length) refs = `
warning: ${unknown.length} design_ref(s) not in the design: ${unknown.join(", ")}`;
          if (design.meta.status === "approved") {
            let approved;
            try {
              approved = readChangelog(import_node_path9.default.dirname(abs(designArg))).at(-1)?.version;
            } catch (e) {
              refs += `
warning: cannot check design_version: ${line2(e.message)}`;
            }
            if (approved !== void 0 && p.design_version !== approved) {
              refs += `
warning: design_version is ${p.design_version ?? "missing"} but the approved design is v${approved}: set design_version: ${approved}`;
            }
            if (design.meta.artifact && p.artifacts.design !== design.meta.artifact) {
              refs += `
warning: artifacts.design is not the design's artifact: set it to ${line2(design.meta.artifact)}`;
            }
          }
        }
        return ok(`ok: ${p.tasks.length} tasks, ${p.phases.length} phases, ${p.tracks.length} tracks${warning}${refs}`);
      }
      case "clean-cache": {
        const p = loadPlan();
        const collection = args[1] ?? "";
        if (!/^[a-z_]{1,32}$/.test(collection)) return fail("clean-cache: <collection> must match ^[a-z_]{1,32}$", 2);
        const root = import_node_path9.default.join(io.cwd, ".waypoint");
        const target = import_node_path9.default.resolve(root, p.project, "dbcache", collection);
        if (!target.startsWith(root + import_node_path9.default.sep)) return fail("clean-cache: path escapes .waypoint", 2);
        (0, import_node_fs8.rmSync)(target, { recursive: true, force: true });
        return ok(target);
      }
      case "hash":
        return ok(planHash(loadPlan()));
      case "page": {
        const p = loadPlan();
        let published;
        if (args.includes("--publish-info")) {
          const capsArg = flag("capabilities");
          if (!capsArg || capsArg.startsWith("--")) return fail("page: --publish-info needs --capabilities <file>, the capabilities JSON passed to the Artifact publish", 2);
          try {
            published = JSON.parse((0, import_node_fs8.readFileSync)(abs(capsArg), "utf8"));
          } catch {
            return fail(`page: cannot read --capabilities ${capsArg} as JSON`, 2);
          }
          if (!published || typeof published !== "object" || Array.isArray(published)) return fail(`page: --capabilities ${capsArg} must be a JSON object`, 2);
        }
        const pageArg = flag("page");
        if (args.includes("--page") && (!pageArg || pageArg.startsWith("--"))) return fail("page: --page needs the listed meta/page.json", 2);
        const out2 = abs(flag("out") ?? ".waypoint/roadmap.html");
        const now = io.now().toISOString();
        const states = flag("states") ? statesOf(abs(flag("states")), p.tasks.map((t) => t.id)) : null;
        const snapshot = { ...buildDocs(p, now), pageVersion: WAYPOINT_VERSION, ...states ? { states: states.states, statesAt: states.at } : {} };
        const tpl = (0, import_node_fs8.readFileSync)(import_node_path9.default.join(io.assetsDir, "roadmap.template.html"), "utf8");
        const html = tpl.replace("__TITLE__", () => `${p.project} Roadmap`).replace("__SNAPSHOT__", () => JSON.stringify(snapshot).replace(/</g, "\\u003c"));
        (0, import_node_fs8.mkdirSync)(import_node_path9.default.dirname(out2), { recursive: true });
        (0, import_node_fs8.writeFileSync)(out2, html);
        if (!args.includes("--publish-info")) return ok(out2);
        let listed = null;
        if (pageArg) {
          try {
            listed = JSON.parse((0, import_node_fs8.readFileSync)(abs(pageArg), "utf8"));
          } catch {
            listed = null;
          }
        }
        const before = listed && typeof listed === "object" && typeof listed.assets === "boolean" ? listed.assets : void 0;
        const internal = args.includes("--assets") || before === true;
        const rules = rulesOf(published);
        const assets = declaresAssets(published);
        let changed = {};
        if (pageArg) {
          const capabilitiesChanged = sharingChanged(p, assets, before);
          changed = { capabilitiesChanged, ask: capabilitiesChanged ? sharingChangeAsk(p, assets) : null };
        }
        return ok(JSON.stringify({
          out: out2,
          capabilities: roadmapCapabilities(internal),
          internal,
          say: sharingNotice(p, internal),
          pageVersion: WAYPOINT_VERSION,
          rules,
          ...changed,
          write: { op: "set", collection: "meta", doc_id: "page", data: { version: WAYPOINT_VERSION, rules, assets, roadmap: p.project, publishedAt: now } }
        }));
      }
      case "sync": {
        const p = loadPlan();
        const knownPath = flag("known");
        const known = knownPath && (0, import_node_fs8.existsSync)(abs(knownPath)) ? JSON.parse((0, import_node_fs8.readFileSync)(abs(knownPath), "utf8")) : {};
        const session = flag("session") ?? "main";
        const now = io.now();
        const outDir = abs(flag("out") ?? ".waypoint/sync");
        const db = flag("db");
        let listed;
        let republish = false;
        let syncedHash = false;
        if (db) {
          for (const c of ["state", "plan", "meta"]) {
            if (jsonFiles(import_node_path9.default.join(abs(db), c)).length >= LIST_LIMIT) {
              return fail(`sync: the listing of ${c} may be truncated (${LIST_LIMIT} documents, the most one list returns): split the plan before syncing it`, 2);
            }
          }
          listed = jsonFiles(import_node_path9.default.join(abs(db), "state")).map((f) => f.slice(0, -5));
          const metaDocs = docsIn(import_node_path9.default.join(abs(db), "meta"));
          const page = metaDocs.page;
          republish = !page || compareVersions(page.version, WAYPOINT_VERSION) < 0 || typeof page.rules !== "number" || page.rules < PAGE_RULES;
          const inDb = { state: new Set(listed), plan: new Set(jsonFiles(import_node_path9.default.join(abs(db), "plan")).map((f) => f.slice(0, -5))), meta: new Set(Object.keys(metaDocs)) };
          const unlisted = [
            ...p.phases.map((ph) => ph.id).filter((id) => inDb.plan.has(id) && !known.plan?.[id]).map((id) => `plan/${id}`),
            ...inDb.meta.has("project") && !known.meta?.project ? ["meta/project"] : []
          ];
          if (unlisted.length) return fail(`sync: known.json has no version of ${unlisted.join(", ")}, which this sync has to write: list the db first (or refresh known.json)`, 2);
          for (const c of ["state", "plan", "meta"]) {
            for (const id of Object.keys(known[c] ?? {})) if (!inDb[c].has(id)) delete known[c][id];
          }
          if (metaDocs.project?.planHash === planHash(p)) syncedHash = true;
        }
        const statesDir = flag("states") ?? (db ? import_node_path9.default.join(db, "state") : void 0);
        const r2 = buildSyncWrites(p, known, outDir, {
          nowIso: now.toISOString(),
          sessionId: session,
          eventId: eventId(now, session, io.rand),
          states: docsIn(statesDir, stateDoc),
          ...listed ? { listed } : {},
          ...syncedHash ? { planSynced: true } : {}
        });
        if (r2.needsList.length) {
          return fail(`sync: known.json has no version of ${r2.needsList.map((id) => `state/${id}`).join(", ")}, which this sync has to write: list state again and write known.json from that listing`, 2);
        }
        const wpDir = import_node_path9.default.join(io.cwd, ".waypoint", p.project);
        const own = (0, import_node_fs8.existsSync)(outDir) && (0, import_node_fs8.existsSync)(wpDir) ? import_node_path9.default.relative((0, import_node_fs8.realpathSync)(wpDir), (0, import_node_fs8.realpathSync)(outDir)) : "";
        if (own && !own.startsWith("..") && !import_node_path9.default.isAbsolute(own)) {
          for (const d of (0, import_node_fs8.readdirSync)(outDir, { withFileTypes: true })) {
            if ((d.isFile() || d.isSymbolicLink()) && isSyncBatch(d.name)) (0, import_node_fs8.rmSync)(import_node_path9.default.join(outDir, d.name), { force: true });
          }
        }
        (0, import_node_fs8.mkdirSync)(outDir, { recursive: true });
        for (const [file, body] of Object.entries(r2.files)) (0, import_node_fs8.writeFileSync)(file, JSON.stringify(body, null, 2));
        return ok(JSON.stringify({ batches: r2.batches, say: syncSummary(p), removed: r2.removed, missing: r2.missing, unknownVersion: r2.unknownVersion, republish }));
      }
      case "doctor": {
        const p = loadPlan();
        const leftovers = leftoversOf(io.cwd, p);
        const { removed, failed } = args.includes("--fix") ? removeLeftovers(io.cwd, leftovers) : { removed: [], failed: [] };
        if (failed.length) return out(1, { project: p.project, leftovers, removed, failed });
        return ok(JSON.stringify({ project: p.project, leftovers, removed }));
      }
      case "next": {
        const session = flag("session");
        if (!session) return fail("next: --session is required", 2);
        const hasBase = args.includes("--base");
        const base = flag("base");
        if (hasBase && (!base || !BRANCH_RE.test(base))) return fail("next: --base needs a branch name", 2);
        const { view } = loadView();
        const sessions = optSessions();
        const states = optStates();
        const integrated = base ? integratedShas(view, states, base, io.cwd) : void 0;
        const r2 = pickTask(view, states, { sessionId: session, track: flag("track"), sessions, now: io.now().getTime(), integrated });
        const { unblock, ...rest } = r2;
        return ok(JSON.stringify(unblock ? r2 : rest));
      }
      case "conflicts": {
        const session = flag("session");
        const task = flag("task");
        if (!session || !task) return fail("conflicts: --session and --task are required", 2);
        const { view } = loadView();
        const sessions = optSessions();
        return ok(JSON.stringify(conflictsFor(view, optStates(), task, session, sessions, io.now().getTime())));
      }
      case "recover": {
        for (const f of ["states", "sessions"]) {
          if (!flag(f) || !(0, import_node_fs8.existsSync)(abs(flag(f)))) return fail(`recover: --${f} cache missing \u2014 list it first`);
        }
        const { view } = loadView();
        const minutes = Number(flag("minutes") ?? IDLE_MINUTES);
        return ok(JSON.stringify(recoverableTasks(
          view,
          docs("states", stateDoc),
          docs("sessions", sessionDoc),
          io.now().getTime(),
          Number.isFinite(minutes) ? minutes : IDLE_MINUTES
        )));
      }
      case "notes": {
        const dir = flag("notes");
        if (!dir) return fail("notes cache missing \u2014 list notes first");
        const localeFlag = flag("locale");
        if (localeFlag !== void 0 && localeFlag !== "es" && localeFlag !== "en") return fail("notes: --locale must be es or en", 2);
        const plan = flag("plan") !== void 0 ? parsePlan((0, import_node_fs8.readFileSync)(abs(flag("plan")), "utf8")) : null;
        const locale = localeFlag ?? (plan?.locale?.toLowerCase().startsWith("es") ? "es" : "en");
        if (!(0, import_node_fs8.existsSync)(abs(dir))) return ok(JSON.stringify({ notes: [], latest: null, say: [], mentions: [] }));
        if (!(0, import_node_fs8.statSync)(abs(dir)).isDirectory()) return fail("notes cache missing \u2014 list notes first");
        const all = [];
        for (const f of (0, import_node_fs8.readdirSync)(abs(dir)).filter((x2) => x2.endsWith(".json")).sort()) {
          try {
            const n = normalizeNote(JSON.parse((0, import_node_fs8.readFileSync)(import_node_path9.default.join(abs(dir), f), "utf8")));
            if (n) all.push({ ...n, id: f.slice(0, -5) });
          } catch {
          }
        }
        const stamps = all.flatMap((n) => [Date.parse(n.ts), Date.parse(n.answeredAt ?? "")]).filter((t) => !Number.isNaN(t));
        const latest = stamps.length ? new Date(Math.max(...stamps)).toISOString() : null;
        const since = flag("since") ?? null;
        const notes = notesSince(all, since);
        const { say, mentions } = noteLines(notes, since, locale, new Set(plan?.tasks.map((t) => t.id) ?? []));
        return ok(JSON.stringify({ notes, latest, say, mentions }));
      }
      case "inbox": {
        const session = flag("session");
        if (!session) return fail("inbox: --session is required", 2);
        return ok(JSON.stringify(inboxFor(docs("messages", normalizeMessage), session)));
      }
      case "escalations":
        return ok(JSON.stringify(escalationCandidates(docs("messages", normalizeMessage))));
      case "launch": {
        if (args.includes("--task")) return fail("launch --task moved to forge swarm tick: forge composes the launch of its run members", 2);
        if (args[0] !== void 0 && !PLAN_PATH.test(args[0])) return fail("launch: the plan path may only use letters, digits, spaces and _ . / \\ : ~ @ + -", 2);
        const p = loadPlan();
        const track = args[1];
        if (!p.tracks.some((t) => t.id === track)) return fail(`launch: unknown track ${track ?? ""}`);
        const SAFE_ID3 = /^[A-Za-z0-9_.~:@+][A-Za-z0-9_\-.~:@+]{0,79}$/;
        const launcherAt = args.indexOf("--launcher");
        const launcher = launcherAt >= 0 ? args[launcherAt + 1] : "bg";
        if (launcher === "herdr") return fail("launch: herdr was removed; use bg", 2);
        if (launcher !== "bg") return fail("launch: --launcher must be bg", 2);
        const swarmAt = args.indexOf("--swarm");
        const swarm = swarmAt >= 0 ? args[swarmAt + 1] : void 0;
        if (swarmAt >= 0 && (!swarm || !SAFE_ID3.test(swarm))) return fail("launch: --swarm needs the coordinator session id", 2);
        if (swarm && args.includes("--merge")) return fail("launch: --swarm and --merge cannot be combined: the swarm coordinator integrates", 2);
        const baseAt = args.indexOf("--base");
        const base = baseAt >= 0 ? args[baseAt + 1] : void 0;
        if (baseAt >= 0 && (!base || !BRANCH_RE.test(base))) return fail("launch: --base needs a branch name", 2);
        if (swarm && !base) return fail("launch: --swarm needs --base <the swarm base branch>", 2);
        const git = (...a) => (0, import_node_child_process4.execFileSync)("git", a, { cwd: io.cwd, encoding: "utf8" }).trim();
        const root = mainWorktreeFrom(git("worktree", "list", "--porcelain")) ?? git("rev-parse", "--show-toplevel");
        const excludeHere = () => excludeWorktrees((a) => {
          try {
            return (0, import_node_child_process4.execFileSync)("git", a, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
          } catch {
            return null;
          }
        });
        const worktree = import_node_path9.default.join(root, ".claude", "worktrees", track);
        const branch = `track/${track}`;
        const name = `wp-${p.project}-${track}`;
        const prompt = `/waypoint:work ${track}` + (args.includes("--merge") ? ` \u2014 the user authorizes merging ${branch} into main at phase close` : "");
        const command = `claude --bg --name ${name} "${prompt}"`;
        const inWorktree = launchRun({ name, prompt, worktree });
        if (!(0, import_node_fs8.existsSync)(worktree)) {
          excludeHere();
          const exists = git("branch", "--list", branch) !== "";
          git("worktree", "add", worktree, ...exists ? [branch] : ["-b", branch, ...base ? [base] : []]);
        }
        if (args.includes("--exec")) {
          const log = import_node_path9.default.join(root, ".waypoint", p.project, "launch", `${name}.log`);
          let fd;
          try {
            (0, import_node_fs8.mkdirSync)(import_node_path9.default.dirname(log), { recursive: true });
            fd = (0, import_node_fs8.openSync)(log, "w");
            (io.spawn ?? nodeSpawn)(command, { cwd: worktree, detached: true, shell: true, windowsHide: true, stdio: ["ignore", fd, fd] }).unref();
          } catch (e) {
            return fail(`launch --exec: ${e.message}`, 1);
          } finally {
            if (fd !== void 0) (0, import_node_fs8.closeSync)(fd);
          }
          return ok(JSON.stringify({ launched: true, worktree, branch, name, prompt, log }));
        }
        const done = ok(JSON.stringify({ worktree, branch, name, prompt, command, run: inWorktree }));
        return swarm ? { ...done, stderr: "--swarm is obsolete: forge composes the launch of its run members\n" } : done;
      }
      case "status": {
        const { view: p, project, version } = loadView();
        const states = optStates();
        const m = computeMetrics(p, states, io.now().getTime());
        const title = (id) => `${id} ${p.tasks.find((t) => t.id === id)?.title ?? ""}`;
        const lines2 = [
          `${project} \xB7 v${version} \xB7 ${m.percent}% (${m.done}/${m.total}) \xB7 phases ${m.phasesDone}/${m.phaseCount}`,
          ...m.inProgress.map((id) => `in progress: ${title(id)}`),
          ...m.blocked.map((id) => `blocked: ${title(id)}`)
        ];
        const next = availableTasks(p, states)[0];
        if (next) lines2.push(`next: ${title(next.id)}`);
        const f = forecastEnd(p, states, io.now().getTime(), { parallel: 1, paceRatio: paceRatioOf(p, states) });
        if (m.paceMin != null) lines2.push(`pace: ${m.paceMin} min/task \xB7 eta: ${f ? new Date(f.at).toISOString() : "-"}`);
        return ok(lines2.join("\n"));
      }
      case "session-id":
        return ok(sessionIdFrom(args.join(" ")));
      case "event-id":
        return ok(eventId(io.now(), args[0] ?? "main", io.rand));
      case "now":
        return ok(io.now().toISOString());
      case "commit-info":
        return ok(JSON.stringify(commitInfo(io.cwd, args[0] ?? "HEAD")));
      case "claim": {
        const f = taskFlags("claim", ["state-version", "session-version"]);
        if ("code" in f) return f;
        if (!planHas(f.task)) return fail(`claim: unknown task ${f.task}`, 2);
        const from = flag("recovered-from");
        if (args.includes("--recovered-from") && (!from || !SID_RE.test(from))) return fail("claim: --recovered-from needs the previous owner", 2);
        const now = io.now();
        const sessions = optSessions();
        const solo = !!sessions && Object.entries(sessions).every(([id, s]) => id === f.sid || isIdle(s, now.getTime()));
        const unblock = args.includes("--unblock");
        const r2 = claimBatch({ sid: f.sid, task: f.task, stateVersion: f.v["state-version"], sessionVersion: f.v["session-version"], now, eids: eventIds(now, f.sid, unblock ? 2 : 1, io.rand), unblock, recoveredFrom: from ?? null });
        mirror(r2.batch);
        return ok(JSON.stringify({ ...r2, solo }));
      }
      case "done": {
        const f = taskFlags("done", ["state-version", "session-version"]);
        if ("code" in f) return f;
        if (!planHas(f.task)) return fail(`done: unknown task ${f.task}`, 2);
        const file = flag("summary-file");
        if (!file) return fail("done: --summary-file is required", 2);
        let summary;
        try {
          summary = (0, import_node_fs8.readFileSync)(abs(file), "utf8");
        } catch {
          return fail(`done: cannot read ${file}`, 2);
        }
        if (!cleanText(summary, SUMMARY_MAX)) return fail("done: the summary file is empty", 2);
        const tests = flag("tests");
        if (tests !== void 0 && !/^\d{1,9}$/.test(tests)) return fail("done: --tests must be a whole number", 2);
        const rev = flag("rev") ?? "HEAD";
        if (!BRANCH_RE.test(rev)) return fail("done: --rev needs a commit", 2);
        const now = io.now();
        const r2 = doneBatch({
          sid: f.sid,
          task: f.task,
          stateVersion: f.v["state-version"],
          sessionVersion: f.v["session-version"],
          now,
          eids: eventIds(now, f.sid, 1, io.rand),
          commit: commitInfo(io.cwd, rev),
          summary,
          ...tests !== void 0 ? { tests: Number(tests) } : {}
        });
        mirror(r2.batch);
        return ok(JSON.stringify(r2));
      }
      case "block": {
        const f = taskFlags("block", ["state-version", "session-version"]);
        if ("code" in f) return f;
        if (!planHas(f.task)) return fail(`block: unknown task ${f.task}`, 2);
        const by = (flag("by") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        if (!by.length || by.some((b) => b !== "external" && (b.startsWith("--") || !isPlanId(b)))) return fail("block: --by needs task ids or external, comma-separated", 2);
        const file = flag("why-file");
        if (!file) return fail("block: --why-file is required", 2);
        let reason;
        try {
          reason = (0, import_node_fs8.readFileSync)(abs(file), "utf8");
        } catch {
          return fail(`block: cannot read ${file}`, 2);
        }
        if (!cleanText(reason, REASON_MAX)) return fail("block: the reason file is empty", 2);
        const now = io.now();
        const r2 = blockBatch({ sid: f.sid, task: f.task, stateVersion: f.v["state-version"], sessionVersion: f.v["session-version"], now, eids: eventIds(now, f.sid, 1, io.rand), by, reason });
        mirror(r2.batch);
        return ok(JSON.stringify(r2));
      }
      case "heartbeat": {
        const sid = flag("session");
        if (!sid || !SID_RE.test(sid)) return fail("heartbeat: --session needs the session id", 2);
        const now = io.now();
        if (args.includes("--register")) {
          const need = (n) => {
            const v = flag(n);
            return v && !v.startsWith("--") ? v.slice(0, 200) : null;
          };
          const name = need("name"), agent = need("agent"), branch = need("branch"), worktree = need("worktree");
          if (!name || !agent || !branch || !worktree) return fail("heartbeat --register: --name, --agent, --branch and --worktree are required", 2);
          const svFlag = flag("session-version");
          const sv2 = svFlag === void 0 ? null : posInt("session-version");
          if (svFlag !== void 0 && sv2 === null) return fail("heartbeat: --session-version must be a positive integer", 2);
          const claude = claudeSessionId(flag("claude"), io.env ?? {});
          const sessions = optSessions();
          if (sessions && heldElsewhere(sessions[sid], now.getTime(), claude, worktree)) return out(3, { held: sid, use: freeSid(sid, sessions, now.getTime(), claude, worktree) });
          return ok(JSON.stringify(registerBatch({ sid, now, name, agent, branch, worktree, track: need("track"), claude, sessionVersion: sv2 })));
        }
        const sv = posInt("session-version");
        if (sv === null) return fail("heartbeat: --session-version must be a positive integer", 2);
        const idle = args.includes("--idle");
        const busy = flag("busy-until");
        if (busy !== void 0 && (idle || !Number.isFinite(Date.parse(busy)))) return fail("heartbeat: --busy-until needs an ISO time, and not with --idle", 2);
        return ok(JSON.stringify(heartbeatBatch({ sid, sessionVersion: sv, now, busyUntil: busy !== void 0 ? new Date(busy) : null, idle })));
      }
      case "bind": {
        if (!args[0] || args[0].startsWith("--")) return fail("usage: waypoint bind <plan.yaml|design.md> --via work|design|forge-run|forge-member|forge-infinite [--claude <id>] [--seat <sid> | --second-seat] [--track <t>] [--resume] [--takeover]", 2);
        const via = flag("via");
        if (!isBoundVia(via)) return fail(`bind: --via must be one of ${BOUND_VIAS.join(", ")}`, 2);
        const claude = claudeSessionId(flag("claude"), io.env ?? {});
        if (!claude) return fail(noClaudeSession("bind", "--claude"), 2);
        const valueOf = (name) => {
          if (!args.includes(`--${name}`)) return void 0;
          const v = flag(name);
          return v && !v.startsWith("-") ? v : null;
        };
        const seatFlag = valueOf("seat");
        const track = valueOf("track");
        if (seatFlag === null || track === null) return fail("bind: --seat and --track need a value", 2);
        const second = args.includes("--second-seat");
        if (second && seatFlag !== void 0) return fail("bind: --seat and --second-seat exclude each other", 2);
        const target = projectOf(abs(args[0]), io.cwd);
        if (!target) return fail(`bind: ${args[0]} is not in a project folder with a valid id`, 2);
        const wp = import_node_path9.default.join(io.cwd, ".waypoint", target.project);
        const rel = (p) => import_node_path9.default.relative(io.cwd, p).split(import_node_path9.default.sep).join("/") || ".";
        const now = io.now();
        const t = now.getTime();
        const open = openTasksOf(wp);
        const own = checkoutSid(wp, t);
        const resume = args.includes("--resume");
        const takeover = args.includes("--takeover");
        const seats = readSeats(wp, t);
        const left = leftSeatOf(seats, open, t);
        const working = seats.find((s) => s.bound?.claude === claude && boundLive(s.bound, t) && !!open[s.sid]);
        const picked = resume ? working ?? left : void 0;
        let sid;
        if (seatFlag !== void 0) sid = seatFlag;
        else if (picked) sid = picked.sid;
        else if (second) sid = secondSeatOf(wp, claude, open, t);
        else sid = own ?? sessionIdFrom(track ?? "main");
        if (sid === null) return fail(`bind: every extra seat (main-2 to main-${MAX_SEATS + 1}) is held by a live conversation`, 2);
        if (!isSafeId(sid) || sid.startsWith("-")) {
          const fix = seatFlag !== void 0 ? "pick another --seat" : own !== null ? `fix the sessionId of ${rel(import_node_path9.default.join(wp, "session.json"))}` : "pick another --track";
          return fail(`bind: the seat id ${JSON.stringify(sid.slice(0, 130))} names a folder: only letters, digits, _ . - and no leading - (${fix})`, 2);
        }
        const seatDir = picked && sid === picked.sid ? picked.dir : second || own !== null && own !== sid ? import_node_path9.default.join(seatsDir(wp), sid) : wp;
        const cur = readBinding(seatDir, sid, t);
        const task = open[sid] ?? null;
        const options = ["worktree", "second-seat", "takeover"];
        const prevOf = (raw) => {
          const b = settleBinding(raw, t);
          return { sid: b.sid, claude: b.claude, endedAt: b.endedAt, endReason: b.endReason, seenAt: b.seenAt, task: open[b.sid] ?? null };
        };
        const held = (b) => ({ held: { sid, claude: b.claude, via: b.via, seenAt: b.seenAt, task }, options, secondSeat: secondSeatOf(wp, claude, open, t), ...left?.bound && left.sid !== sid ? { previous: prevOf(left.bound) } : {} });
        let took;
        if (!cur) took = "new";
        else if (cur.claude === claude) took = "same";
        else if (boundLive(cur, t)) {
          if (!takeover) return out(3, held(cur));
          took = "takeover";
        } else if (task && !resume && !takeover) return out(4, { previous: prevOf(cur), options: ["resume", "release"] });
        else took = "previous";
        const iso4 = now.toISOString();
        writeBinding(boundFile(seatDir), { sid, claude, pid: pidFromEnv(io.env), via, since: took === "same" && cur ? cur.since : iso4, seenAt: iso4, endedAt: null, endReason: null });
        const back = readBinding(seatDir, sid, t);
        if (!back || back.claude !== claude) return out(3, back ? held(back) : { held: null, options, secondSeat: null });
        for (const s of readSeats(wp, t)) {
          if (s.sid !== sid && s.bound?.claude === claude && s.bound.endedAt === null) writeBinding(boundFile(s.dir), { ...s.bound, endedAt: iso4, endReason: "released" });
        }
        const sessionFile = import_node_path9.default.join(seatDir, "session.json");
        let session = {};
        try {
          const v = JSON.parse((0, import_node_fs8.readFileSync)(sessionFile, "utf8"));
          if (v && typeof v === "object" && !Array.isArray(v)) session = v;
        } catch {
          session = {};
        }
        const merged = { ...target.plan ? { plan: target.plan, url: target.url } : {}, sessionId: sid, track: track ?? null, ...session };
        if (Object.keys(merged).length !== Object.keys(session).length) writeAtomic(sessionFile, `${JSON.stringify(merged, null, 2)}
`);
        recordBase(seatDir, claude, io.cwd);
        return out(0, { took, sid, seatDir: rel(seatDir), sessionFile: rel(sessionFile), claude, via, ...cur && (took === "takeover" || took === "previous") ? { previous: prevOf(cur) } : {} });
      }
      case "release": {
        if (!args[0] || args[0].startsWith("--")) return fail("usage: waypoint release <plan.yaml|design.md> [--seat <sid>] [--claude <id>] [--free <T> --state-version <V> [--session-version <SV>] [--db <dir>] [--keep-seat]]", 2);
        const keepSeat = args.includes("--keep-seat");
        if (keepSeat && flag("free") === void 0) return fail("release: --keep-seat goes with --free <T>", 2);
        const dbFlag = flag("db");
        if (args.includes("--db") && (!dbFlag || dbFlag.startsWith("-"))) return fail("release: --db needs the cache directory", 2);
        const target = projectOf(abs(args[0]), io.cwd);
        if (!target) return fail(`release: ${args[0]} is not in a project folder with a valid id`, 2);
        const wp = import_node_path9.default.join(io.cwd, ".waypoint", target.project);
        const rel = (p) => import_node_path9.default.relative(io.cwd, p).split(import_node_path9.default.sep).join("/") || ".";
        const now = io.now();
        const t = now.getTime();
        const claude = claudeSessionId(flag("claude"), io.env ?? {});
        const seats = readSeats(wp, t);
        const seatFlag = flag("seat");
        if (args.includes("--seat") && (!seatFlag || seatFlag.startsWith("-"))) return fail("release: --seat needs a seat id", 2);
        const seat = seatFlag !== void 0 ? seats.find((s) => s.sid === seatFlag) : (claude ? seats.find((s) => s.bound?.claude === claude) : void 0) ?? seats.find((s) => s.checkout);
        if (!seat) return fail(seatFlag !== void 0 ? `release: no seat ${seatFlag} in ${rel(wp)}` : `release: no seat in ${rel(wp)}`, 2);
        let batch;
        const db = dbFlag !== void 0 ? abs(dbFlag) : import_node_path9.default.join(wp, "dbcache");
        const free = flag("free");
        if (free !== void 0) {
          if (!isPlanId(free)) return fail("release: --free needs a task id", 2);
          const v = posInt("state-version");
          if (v === null) return fail("release: --state-version must be a positive integer", 2);
          const svFlag = flag("session-version");
          const sv = svFlag === void 0 ? null : posInt("session-version");
          if (svFlag !== void 0 && sv === null) return fail("release: --session-version must be a positive integer", 2);
          let owner = null;
          try {
            owner = JSON.parse((0, import_node_fs8.readFileSync)(import_node_path9.default.join(db, "state", `${free}.json`), "utf8")).owner;
          } catch {
            owner = null;
          }
          if (owner !== seat.sid) return fail(`release: ${free} is not held by seat ${seat.sid} in the state cache (list state first)`, 2);
          batch = freeBatch({ sid: seat.sid, task: free, stateVersion: v, sessionVersion: sv, keepSeat });
        }
        const b = seat.bound;
        if (b && b.claude !== claude && boundLive(b, t)) return fail(`release: ${seat.sid} is bound to another live session`, 3);
        let released = false;
        if (!keepSeat && b && b.claude === claude && b.endedAt === null) {
          writeBinding(boundFile(seat.dir), { ...b, endedAt: now.toISOString(), endReason: "released" });
          released = true;
        }
        if (batch) mirrorState(db, batch[0]);
        return out(0, { released, sid: seat.sid, seatDir: rel(seat.dir), now: now.toISOString(), ...batch ? { batch } : {} });
      }
      case "design-validate": {
        const d = parseDesign((0, import_node_fs8.readFileSync)(abs(args[0]), "utf8"));
        const log = readChangelog(import_node_path9.default.dirname(abs(args[0])));
        const sections = d.sections.length;
        return ok(`ok: ${d.words} words, ${sections} sections, v${log[log.length - 1]?.version ?? 0}`);
      }
      case "design-park": {
        if (!args[0] || args[0].startsWith("--")) return fail("usage: waypoint design-park <design.md>", 2);
        const file = abs(args[0]);
        let text;
        try {
          text = (0, import_node_fs8.readFileSync)(file, "utf8");
        } catch {
          return fail(`design-park: cannot read ${args[0]}`, 2);
        }
        const d = parseDesign(text);
        if (d.meta.status === "parked") return ok(JSON.stringify({ path: file, status: "parked", changed: false }));
        if (d.meta.status !== "draft") return fail(`design-park: only a draft design can be parked (this one is ${d.meta.status})`, 2);
        const next = setDesignStatus(text, "parked");
        parseDesign(next);
        writeAtomic(file, next);
        return ok(JSON.stringify({ path: file, status: "parked", changed: true }));
      }
      case "design-import": {
        const spec = args[0];
        const project = flag("project");
        const out2 = flag("out");
        if (!spec || spec.startsWith("--") || !project || !out2) return fail("usage: waypoint design-import <spec.md> --project <id> [--locale <l>] --out <design.md>", 2);
        if (!/^[A-Za-z0-9_.-]{1,64}$/.test(project) || project === "." || project === "..") return fail(`design-import: invalid project id ${project}`, 2);
        const target = abs(out2);
        if ((0, import_node_fs8.existsSync)(target)) return fail(`design-import: ${out2} already exists; an import never overwrites a design`, 2);
        let text;
        try {
          text = (0, import_node_fs8.readFileSync)(abs(spec), "utf8");
        } catch {
          return fail(`design-import: cannot read ${spec}`, 2);
        }
        let source = import_node_path9.default.relative(io.cwd, abs(spec)).split(import_node_path9.default.sep).join("/");
        try {
          const top = (0, import_node_child_process4.execFileSync)("git", ["rev-parse", "--show-toplevel"], { cwd: import_node_path9.default.dirname(abs(spec)), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
          const rel = import_node_path9.default.relative(import_node_path9.default.resolve(top), abs(spec)).split(import_node_path9.default.sep).join("/");
          if (!rel.startsWith("..") && !import_node_path9.default.isAbsolute(rel)) source = rel;
        } catch {
        }
        let design;
        try {
          design = importSpec(text, { project, locale: flag("locale") ?? "en", source });
        } catch (e) {
          if (e instanceof SpecImportError) return fail(`design-import: ${e.message}`, 2);
          throw e;
        }
        let d;
        try {
          d = parseDesign(design);
        } catch (e) {
          if (e instanceof DesignError) return fail(`design-import: ${e.message}`, 2);
          throw e;
        }
        (0, import_node_fs8.mkdirSync)(import_node_path9.default.dirname(target), { recursive: true });
        try {
          (0, import_node_fs8.writeFileSync)(target, design, { flag: "wx" });
        } catch (e) {
          if (e.code === "EEXIST") return fail(`design-import: ${out2} already exists; an import never overwrites a design`, 2);
          throw e;
        }
        return ok(JSON.stringify({ path: target, title: d.meta.title, sections: d.sections.length, words: d.words, source }));
      }
      case "design-snapshot": {
        const file = abs(args[0]);
        if (args.includes("--note-file") && flag("note-file") === void 0) return fail("design-snapshot: --note-file needs a file", 2);
        if (flag("note") !== void 0 && flag("note-file") !== void 0) return fail("design-snapshot: --note and --note-file are exclusive", 2);
        let note = flag("note");
        if (flag("note-file") !== void 0) {
          try {
            note = (0, import_node_fs8.readFileSync)(abs(flag("note-file")), "utf8").replace(/[\r\n]+$/, "");
          } catch {
            return fail(`design-snapshot: cannot read ${flag("note-file")}`, 2);
          }
        }
        if (!note) return fail("design-snapshot: --note or --note-file is required", 2);
        const text = (0, import_node_fs8.readFileSync)(file, "utf8");
        const d = parseDesign(text);
        const base = import_node_path9.default.join(import_node_path9.default.dirname(file), "design");
        const histDir = import_node_path9.default.join(base, "history");
        const log = readChangelog(import_node_path9.default.dirname(file));
        const version = nextVersion((0, import_node_fs8.existsSync)(histDir) ? (0, import_node_fs8.readdirSync)(histDir) : []);
        const files = designFilesOf(file, d.meta.project);
        const critiques = readCritiques(files);
        const roundFlag = flag("round");
        const round = roundFlag !== void 0 ? Number(roundFlag) : Math.max(entryRound(log[log.length - 1]), ...critiques.map((c) => c.round));
        if (!Number.isInteger(round) || round < 0) return fail("design-snapshot: --round must be a non-negative integer", 2);
        const kindFlag = flag("kind");
        if (args.includes("--kind") && (kindFlag === void 0 || !ENTRY_KINDS.includes(kindFlag))) {
          return fail(`design-snapshot: --kind must be one of ${ENTRY_KINDS.join(", ")}`, 2);
        }
        const kindGiven = kindFlag;
        if (kindGiven === "approve" && (args.includes("--applied") || args.includes("--rewrite"))) {
          return fail("design-snapshot: --kind approve cannot go with --applied or --rewrite: the entry would hide what it applied", 2);
        }
        if ((kindGiven === "amend" || kindGiven === "approve") && d.meta.status !== "approved") {
          return fail(`design-snapshot: --kind ${kindGiven} needs status: approved in the design (it is ${d.meta.status})`, 2);
        }
        if (kindGiven === "reopen" && d.meta.status !== "draft") {
          return fail(`design-snapshot: --kind reopen needs status: draft in the design (it is ${d.meta.status}); set it first`, 2);
        }
        if (kindGiven === "reopen" && !Object.values(readHistory(import_node_path9.default.dirname(file))).some((t) => designStatus(t) === "approved") && !log.some((e) => entryKind(e) === "approve")) {
          return fail("design-snapshot: --kind reopen needs a design that was approved once: this draft was never approved, so there is nothing to reopen", 2);
        }
        const critiqueOf = (r2) => critiques.find((c) => c.round === r2)?.critique ?? null;
        const items = { applied: null, resolved: null };
        for (const name of ["applied", "resolved"]) {
          const at2 = args.indexOf(`--${name}`);
          if (at2 < 0) continue;
          const end = args.findIndex((a, i) => i > at2 && a.startsWith("--"));
          let got;
          try {
            got = parseAppliedItems(args.slice(at2 + 1, end < 0 ? args.length : end), roundFlag !== void 0 ? round : null, name);
          } catch (e) {
            if (e instanceof AppliedError) return fail(`design-snapshot: ${e.message}`, 2);
            throw e;
          }
          for (const [r2, ns] of Object.entries(got)) {
            const c = critiqueOf(Number(r2));
            if (!c) return fail(`design-snapshot: round ${r2} has no critique (${import_node_path9.default.join(files.critiques, `r${r2}.json`)})`, 2);
            const missing = ns.filter((n) => !c.proposals.some((p) => p.n === n));
            if (missing.length) return fail(`design-snapshot: round ${r2} has no proposal ${missing.join(", ")}`, 2);
          }
          items[name] = got;
        }
        const applied = items.applied;
        const resolved = items.resolved ? roundList(items.resolved) : null;
        const rewrite = args.includes("--rewrite");
        if (rewrite && (roundFlag === void 0 || !critiqueOf(round))) return fail("design-snapshot: --rewrite needs --round <R> and the critique of that round", 2);
        const kind = kindGiven ?? (rewrite ? "rewrite" : applied ? "apply" : void 0);
        const next = appendChangelog(log, {
          version,
          date: io.now().toISOString().slice(0, 10),
          note,
          words: d.words,
          round,
          ...applied ? { applied } : {},
          ...rewrite ? { rewrite: true } : {},
          ...resolved ? { resolved } : {},
          ...kind ? { kind } : {}
        });
        (0, import_node_fs8.mkdirSync)(histDir, { recursive: true });
        const dest = import_node_path9.default.join(histDir, `v${version}.md`);
        try {
          (0, import_node_fs8.writeFileSync)(dest, text, { flag: "wx" });
        } catch (e) {
          if (e.code === "EEXIST") return fail(`design-snapshot: ${dest} already exists; history is immutable`);
          throw e;
        }
        (0, import_node_fs8.writeFileSync)(import_node_path9.default.join(base, "changelog.json"), JSON.stringify(next, null, 2) + "\n");
        return ok(JSON.stringify({ version, path: dest, ...applied ? { applied } : {}, ...resolved ? { resolved } : {}, ...kind ? { kind } : {} }));
      }
      case "design-changed": {
        const file = abs(args[0]);
        const text = (0, import_node_fs8.readFileSync)(file, "utf8");
        const d = parseDesign(text);
        const histDir = import_node_path9.default.join(import_node_path9.default.dirname(file), "design", "history");
        const versions = listVersions((0, import_node_fs8.existsSync)(histDir) ? (0, import_node_fs8.readdirSync)(histDir) : []);
        const sinceFlag = flag("since");
        const since = sinceFlag !== void 0 ? Number(sinceFlag) : versions[versions.length - 1];
        const prevFile = since !== void 0 ? import_node_path9.default.join(histDir, `v${since}.md`) : void 0;
        if (since === void 0 || !prevFile || !(0, import_node_fs8.existsSync)(prevFile)) {
          if (sinceFlag !== void 0) return fail(`design-changed: no history for v${sinceFlag}`);
          return ok(JSON.stringify({ since: 0, changed: d.sections.map((s) => s.slug), removed: [], scope: "full" }));
        }
        const { changed, removed } = changedSections(designBody((0, import_node_fs8.readFileSync)(prevFile, "utf8")), d.body);
        const total = d.sections.length;
        const count = changed.filter((s) => s !== "_intro").length + removed.length;
        return ok(JSON.stringify({ since, changed, removed, scope: total === 0 || count * 2 > total ? "full" : "changed" }));
      }
      case "design-gate": {
        if (!args[0] || args[0].startsWith("--")) return fail("usage: waypoint design-gate <design.md>", 2);
        const file = abs(args[0]);
        const text = (0, import_node_fs8.readFileSync)(file, "utf8");
        const d = parseDesign(text);
        const files = designFilesOf(file, d.meta.project);
        return ok(JSON.stringify(designGate(readChangelog(files.dir), readCritiques(files), readDismissedOf(files), { history: readHistory(files.dir), current: text })));
      }
      case "critique-next": {
        if (!args[0] || args[0].startsWith("--")) return fail("usage: waypoint critique-next <design.md> [--verify] [--full]", 2);
        const file = abs(args[0]);
        const text = (0, import_node_fs8.readFileSync)(file, "utf8");
        const d = parseDesign(text);
        const files = designFilesOf(file, d.meta.project);
        const critiques = readCritiques(files);
        const verify = args.includes("--verify");
        if (verify && !critiques.some((c) => c.critique !== null)) return fail("critique-next: nothing to verify: no critique yet, run a round first", 2);
        const next = nextRound({
          changelog: readChangelog(files.dir),
          critiques,
          history: readHistory(files.dir),
          current: text,
          sections: d.sections.map((s) => s.slug),
          verify,
          full: args.includes("--full")
        });
        return ok(JSON.stringify({ ...next, out: import_node_path9.default.join(files.critiques, `r${next.round}.json`) }));
      }
      case "design-impact": {
        const usage = "usage: waypoint design-impact <design.md> --plan <plan.yaml> [--since <N>] [--states <dir>]";
        if (!args[0] || args[0].startsWith("--") || !flag("plan")) return fail(usage, 2);
        const sinceFlag = flag("since");
        if (sinceFlag !== void 0 && !/^[1-9]\d*$/.test(sinceFlag)) return fail("design-impact: --since must be a positive integer", 2);
        const file = abs(args[0]);
        const d = readDesignArg("design-impact", args[0]);
        if ("code" in d) return d;
        let plan;
        try {
          plan = parsePlan((0, import_node_fs8.readFileSync)(abs(flag("plan")), "utf8"));
        } catch (e) {
          return fail(`design-impact: ${e.message}`, 2);
        }
        const dir = import_node_path9.default.dirname(file);
        const history = readHistory(dir);
        const versions = Object.keys(history).map(Number);
        const current = readChangelog(dir).at(-1)?.version ?? Math.max(0, ...versions);
        const before = versions.filter((v) => v < current).sort((a, b) => b - a)[0];
        const since = sinceFlag !== void 0 ? Number(sinceFlag) : plan.design_version ?? before ?? 0;
        if (since > 0 && history[since] === void 0) return fail(`design-impact: no history for v${since}`, 2);
        const { changed, removed } = since > 0 ? changedSections(designBody(history[since]), d.body) : { changed: ["_intro", ...d.sections.map((s) => s.slug)], removed: [] };
        const states = flag("states") ? statesOf(abs(flag("states")), plan.tasks.map((t) => t.id))?.states ?? {} : {};
        const hit = /* @__PURE__ */ new Set([...changed, ...removed]);
        const tasks = plan.tasks.filter((t) => t.design_ref && hit.has(t.design_ref)).map((t) => ({ id: t.id, ref: t.design_ref, status: states[t.id] ?? null }));
        return ok(JSON.stringify({ since, changed, removed, tasks, unref: plan.tasks.filter((t) => !t.design_ref).length }));
      }
      case "critique-dismiss": {
        const usage = "usage: waypoint critique-dismiss <design.md> --round <R> <all|1,3> [--reason-file <f>]";
        const valued = /* @__PURE__ */ new Set(["--round", "--reason-file"]);
        const rest = args.slice(1);
        const spec = rest.filter((a, i) => !valued.has(a) && !valued.has(rest[i - 1]))[0];
        const roundFlag = flag("round");
        if (!args[0] || args[0].startsWith("--") || !args.includes("--round") || !spec || spec.startsWith("--")) return fail(usage, 2);
        if (!roundFlag || !/^[1-9]\d*$/.test(roundFlag)) return fail("critique-dismiss: --round must be a positive integer", 2);
        const round = Number(roundFlag);
        let reason;
        if (args.includes("--reason-file")) {
          const reasonFile = flag("reason-file");
          if (!reasonFile || reasonFile.startsWith("--")) return fail(usage, 2);
          try {
            reason = readHead(abs(reasonFile), REASON_READ_MAX);
          } catch {
            return fail(`critique-dismiss: cannot read ${reasonFile}`, 2);
          }
          if (PLACEHOLDER_REASONS.has(reasonKey(reason))) return fail(`critique-dismiss: "${reason.trim().slice(0, 60)}" is a placeholder, not a reason: pass the person's own words`, 2);
        }
        const file = abs(args[0]);
        const d = parseDesign((0, import_node_fs8.readFileSync)(file, "utf8"));
        const files = designFilesOf(file, d.meta.project);
        const entry = readCritiques(files).find((c) => c.round === round);
        if (!entry) return fail(`critique-dismiss: no critique for round ${round} (${import_node_path9.default.join(files.critiques, `r${round}.json`)})`, 2);
        if (!entry.critique) return fail(`critique-dismiss: the critique of round ${round} is not valid (${entry.file})`, 2);
        let picked;
        try {
          picked = selectProposals(entry.critique, spec);
        } catch (e) {
          if (e instanceof CritiqueError) return fail(`critique-dismiss: ${e.message}`, 2);
          throw e;
        }
        const next = mergeDismissed(readDismissedOf(files), round, picked.map((p) => p.n), reason);
        const bare = picked.filter((p) => p.severity !== "minor" && !(next[round] ?? []).find((x2) => x2.n === p.n)?.reason).map((p) => p.n);
        if (bare.length) return fail(`critique-dismiss: ${bare.length === 1 ? "proposal" : "proposals"} ${bare.join(", ")} of round ${round} ${bare.length === 1 ? "is" : "are"} major or critical and need a reason: pass --reason-file <f> with the person's words`, 2);
        writeDismissed(files, next);
        return ok(JSON.stringify({ round, dismissed: (next[round] ?? []).map((x2) => x2.n) }));
      }
      case "critique-check": {
        const target = abs(args[0]);
        const changedFlag = flag("changed");
        const allowed = (changedFlag ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        if (args.includes("--changed") && (!changedFlag || changedFlag.startsWith("--") || !allowed.length)) {
          return fail("critique-check: --changed needs the changed section slugs, comma-separated", 2);
        }
        try {
          const c = parseCritique((0, import_node_fs8.readFileSync)(target, "utf8"));
          const issues = [];
          for (const name of ["round", "version"]) {
            const given = flag(name);
            if (given === void 0) continue;
            if (!/^[1-9]\d*$/.test(given)) return fail(`critique-check: --${name} must be a positive integer`, 2);
            if (c[name] !== Number(given)) issues.push(`${name} is ${c[name]} but this review is ${name} ${given}`);
          }
          const roundGiven = flag("round");
          const designFlag = flag("design");
          const designParsed = designFlag !== void 0 ? parseDesign((0, import_node_fs8.readFileSync)(abs(designFlag), "utf8")) : null;
          const absolute = roundGiven !== void 0 ? Number(roundGiven) : c.round;
          let budgetAt = absolute;
          if (designFlag !== void 0 && designParsed) {
            let log;
            try {
              log = readChangelog(designFilesOf(abs(designFlag), designParsed.meta.project).dir);
            } catch (e) {
              return fail(`critique-check: cannot read the changelog of the design: ${e.message}`, 2);
            }
            budgetAt = budgetRound(log, absolute);
          }
          issues.push(...budgetIssues(c, budgetFor(budgetAt, args.includes("--verify"))));
          const headings = {};
          if (designParsed) {
            const sections = designParsed.sections;
            for (const s of sections) headings[s.slug] = s.heading;
            const slugs = /* @__PURE__ */ new Set(["_intro", ...sections.map((s) => s.slug)]);
            for (const p of c.proposals) if (!slugs.has(p.section)) issues.push(`proposal ${p.n}: section "${line2(p.section)}" is not a section slug of the design`);
          }
          if (issues.length) throw new CritiqueError(issues);
          const warnings2 = [];
          if (changedFlag !== void 0 && c.scope === "changed") {
            for (const p of c.proposals) {
              if (!allowed.includes(p.section)) warnings2.push(`warning: proposal ${p.n} reviews "${line2(p.section)}", outside the changed sections (${line2(allowed.join(", "))})`);
            }
          }
          const text = formatProposals(c, flag("locale") ?? "en", headings);
          return { code: 0, stdout: text.endsWith("\n") ? text : `${text}
`, stderr: warnings2.length ? `${warnings2.join("\n")}
` : "" };
        } catch (e) {
          if (!(e instanceof CritiqueError) || !args.includes("--reject-on-fail") || !(0, import_node_fs8.existsSync)(target)) throw e;
          const name = import_node_path9.default.basename(target);
          if (!CRITIQUE_FILE.test(name) && !LEGACY_CRITIQUE_FILE.test(name)) {
            return fail(`${e.message}
critique-check: ${target} is not a critique round file (r<N>.json or critique-r<N>.json): not set aside`);
          }
          const rejected = import_node_path9.default.join(import_node_path9.default.dirname(target), `${name.slice(0, -".json".length)}.rejected.json`);
          (0, import_node_fs8.rmSync)(rejected, { force: true });
          (0, import_node_fs8.renameSync)(target, rejected);
          return fail(`${e.message}
critique-check: the critique was refused and set aside as ${rejected}`);
        }
      }
      case "critique-select": {
        const c = parseCritique((0, import_node_fs8.readFileSync)(abs(args[0]), "utf8"));
        if (!args[1]) return fail("critique-select: <spec> is required", 2);
        return ok(JSON.stringify(selectProposals(c, args[1])));
      }
      case "design-page": {
        const file = abs(args[0]);
        const out2 = flag("out");
        if (!out2) return fail("design-page: --out is required", 2);
        const dirPath = import_node_path9.default.dirname(file);
        const history = readHistory(dirPath);
        const current = (0, import_node_fs8.readFileSync)(file, "utf8");
        const project = parseDesign(current).meta.project;
        let source = `docs/waypoint/${project}/`;
        try {
          const root = (0, import_node_child_process4.execFileSync)("git", ["rev-parse", "--show-toplevel"], { cwd: dirPath, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
          const rel = import_node_path9.default.relative(import_node_path9.default.resolve(root), dirPath).split(import_node_path9.default.sep).join("/");
          if (!rel.startsWith("..") && !import_node_path9.default.isAbsolute(rel)) source = rel ? `${rel}/` : "";
        } catch {
        }
        const files = designFilesOf(file, project);
        const data = buildDesignPageData({ current, history, changelog: readChangelog(dirPath), source, critiques: readCritiques(files), dismissed: readDismissedOf(files) });
        const tpl = (0, import_node_fs8.readFileSync)(import_node_path9.default.join(io.assetsDir, "design.template.html"), "utf8");
        const title = `${data.meta.title.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")} \xB7 Design`;
        const json = JSON.stringify(data).replace(/</g, "\\u003c").replace(new RegExp(String.fromCharCode(8232), "g"), "\\u2028").replace(new RegExp(String.fromCharCode(8233), "g"), "\\u2029");
        const html = tpl.replace(/__TITLE__|__DATA__/g, (m) => m === "__TITLE__" ? title : json);
        const target = abs(out2);
        (0, import_node_fs8.mkdirSync)(import_node_path9.default.dirname(target), { recursive: true });
        (0, import_node_fs8.writeFileSync)(target, html);
        return ok(target);
      }
      case "hook": {
        try {
          const out2 = runHook(args[0], io);
          return out2 ? ok(out2) : { code: 0, stdout: "", stderr: "" };
        } catch {
          return { code: 0, stdout: "", stderr: "" };
        }
      }
      default:
        return fail(USAGE, 2);
    }
  } catch (e) {
    if (e instanceof DesignError || e instanceof CritiqueError) return fail(e.message);
    if (e instanceof PlanError || e instanceof CacheError) return fail(e.message);
    return fail(`error: ${e.message}`);
  }
}
var CacheError = class extends Error {
};
var SHA_RE = /^[0-9a-f]{7,64}$/;
var PLACEHOLDER_REASONS = /* @__PURE__ */ new Set([
  "dismissed",
  "dismissed at approval",
  "dismissed on approval",
  "dismissed when approving",
  "no reason",
  "no reason given",
  "none",
  "n a",
  "na",
  "tbd",
  "todo",
  "ok",
  "wontfix",
  "descartada",
  "descartado",
  "descartada al aprobar",
  "descartado al aprobar",
  "descartada en la aprobacion",
  "descartado en la aprobacion",
  "sin motivo",
  "sin razon",
  "ninguno",
  "ninguna",
  "no aplica"
]);
var REASON_READ_MAX = 64 * 1024;
function readHead(file, max) {
  const fd = (0, import_node_fs8.openSync)(file, "r");
  try {
    const buf = Buffer.alloc(max);
    let got = 0;
    for (let n = 1; got < max && n > 0; got += n) n = (0, import_node_fs8.readSync)(fd, buf, got, max - got, got);
    return buf.subarray(0, got).toString("utf8");
  } finally {
    (0, import_node_fs8.closeSync)(fd);
  }
}
function reasonKey(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function integratedShas(plan, states, base, cwd) {
  const trackOf = new Map(plan.tasks.map((t) => [t.id, t.track]));
  const deps = new Set(plan.tasks.flatMap((t) => t.depends_on.filter((d) => trackOf.has(d) && trackOf.get(d) !== t.track)));
  const out = /* @__PURE__ */ new Set();
  for (const id of deps) {
    if (states[id]?.status !== "done") continue;
    for (const sha of commitShas(states, id)) {
      if (!SHA_RE.test(sha)) continue;
      try {
        (0, import_node_child_process4.execFileSync)("git", ["merge-base", "--is-ancestor", sha, base], { cwd, stdio: "ignore" });
        out.add(sha);
      } catch {
      }
    }
  }
  return out;
}
function commitInfo(cwd, rev) {
  const git = (...a) => (0, import_node_child_process4.execFileSync)("git", a, { cwd, encoding: "utf8" });
  const [sha, ts, ...title] = git("log", "-1", "--format=%H%x09%cI%x09%s", rev).trim().split("	");
  const stat = git("show", "--shortstat", "--format=", rev);
  const num = (re2) => Number(stat.match(re2)?.[1] ?? 0);
  return { sha, ts: new Date(ts).toISOString(), title: title.join("	"), add: num(/(\d+) insertion/), del: num(/(\d+) deletion/) };
}
function mirrorState(db, write) {
  if (write.collection !== "state" || !write.data || !isPlanId(write.doc_id)) return;
  const file = import_node_path9.default.join(db, "state", `${write.doc_id}.json`);
  let cur = {};
  try {
    const v = JSON.parse((0, import_node_fs8.readFileSync)(file, "utf8"));
    if (v && typeof v === "object" && !Array.isArray(v)) cur = v;
  } catch {
    cur = {};
  }
  for (const [k2, v] of Object.entries(write.data)) {
    if (v && typeof v === "object" && v.__delete__ === true) delete cur[k2];
    else cur[k2] = v;
  }
  writeAtomic(file, JSON.stringify(cur));
}
function heldElsewhere(doc, now, claude, worktree) {
  return !!doc && !isIdle(doc, now) && (claude === null || doc.claude !== claude) && !(typeof doc.worktree === "string" && samePath(doc.worktree, worktree));
}
function freeSid(sid, sessions, now, claude, worktree) {
  for (let n = 2; n < 100; n++) if (!heldElsewhere(sessions[`${sid}-${n}`], now, claude, worktree)) return `${sid}-${n}`;
  return `${sid}-100`;
}
function projectOf(file, cwd) {
  const rel = (p2) => import_node_path9.default.relative(cwd, p2).split(import_node_path9.default.sep).join("/");
  if (import_node_path9.default.basename(file) === "design.md") {
    parseDesign((0, import_node_fs8.readFileSync)(file, "utf8"));
    const project = import_node_path9.default.basename(import_node_path9.default.dirname(file));
    if (!isPlanId(project)) return null;
    const planFile = import_node_path9.default.join(import_node_path9.default.dirname(file), "plan.yaml");
    if (!(0, import_node_fs8.existsSync)(planFile)) return { project, plan: null, url: null };
    let url = null;
    try {
      url = parsePlan((0, import_node_fs8.readFileSync)(planFile, "utf8")).artifacts.roadmap ?? null;
    } catch {
      url = null;
    }
    return { project, plan: rel(planFile), url };
  }
  const p = parsePlan((0, import_node_fs8.readFileSync)(file, "utf8"));
  return { project: p.project, plan: rel(file), url: p.artifacts.roadmap ?? null };
}
function statesOf(dir, taskIds) {
  if (!(0, import_node_fs8.existsSync)(dir)) return null;
  const states = {};
  let newest2 = 0;
  for (const id of [...new Set(taskIds)].filter(isPlanId).sort()) {
    const file = import_node_path9.default.join(dir, `${id}.json`);
    try {
      const doc = JSON.parse((0, import_node_fs8.readFileSync)(file, "utf8"));
      if (!doc || typeof doc.status !== "string" || !TASK_STATUSES.includes(doc.status)) continue;
      const mtime = (0, import_node_fs8.statSync)(file).mtimeMs;
      states[id] = doc.status;
      newest2 = Math.max(newest2, mtime);
    } catch {
    }
  }
  return Object.keys(states).length ? { states, at: new Date(newest2).toISOString() } : null;
}
var LIST_LIMIT = 1e3;
var jsonFiles = (dir) => (0, import_node_fs8.existsSync)(dir) ? (0, import_node_fs8.readdirSync)(dir).filter((f) => f.endsWith(".json")) : [];
function readChangelog(designDir) {
  const f = import_node_path9.default.join(designDir, "design", "changelog.json");
  return parseChangelog((0, import_node_fs8.existsSync)(f) ? (0, import_node_fs8.readFileSync)(f, "utf8") : null);
}

// src/cli/main.ts
var stdin = "";
if (process.argv[2] === "hook") {
  try {
    stdin = (0, import_node_fs9.readFileSync)(0, "utf8");
  } catch {
    stdin = "";
  }
}
var r = run(process.argv.slice(2), {
  stdin,
  env: process.env,
  cwd: process.cwd(),
  now: () => /* @__PURE__ */ new Date(),
  assetsDir: process.env.WAYPOINT_ASSETS ?? import_node_path10.default.resolve(import_node_path10.default.dirname(process.argv[1]), "../assets")
});
process.stdout.write(r.stdout);
process.stderr.write(r.stderr);
process.exitCode = r.code;
