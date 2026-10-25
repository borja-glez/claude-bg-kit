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
    var isAlias = (node2) => !!node2 && typeof node2 === "object" && node2[NODE_TYPE] === ALIAS;
    var isDocument = (node2) => !!node2 && typeof node2 === "object" && node2[NODE_TYPE] === DOC;
    var isMap2 = (node2) => !!node2 && typeof node2 === "object" && node2[NODE_TYPE] === MAP;
    var isPair = (node2) => !!node2 && typeof node2 === "object" && node2[NODE_TYPE] === PAIR;
    var isScalar2 = (node2) => !!node2 && typeof node2 === "object" && node2[NODE_TYPE] === SCALAR;
    var isSeq2 = (node2) => !!node2 && typeof node2 === "object" && node2[NODE_TYPE] === SEQ;
    function isCollection(node2) {
      if (node2 && typeof node2 === "object")
        switch (node2[NODE_TYPE]) {
          case MAP:
          case SEQ:
            return true;
        }
      return false;
    }
    function isNode(node2) {
      if (node2 && typeof node2 === "object")
        switch (node2[NODE_TYPE]) {
          case ALIAS:
          case MAP:
          case SCALAR:
          case SEQ:
            return true;
        }
      return false;
    }
    var hasAnchor = (node2) => (isScalar2(node2) || isCollection(node2)) && !!node2.anchor;
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
    exports2.isMap = isMap2;
    exports2.isNode = isNode;
    exports2.isPair = isPair;
    exports2.isScalar = isScalar2;
    exports2.isSeq = isSeq2;
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
    function visit2(node2, visitor) {
      const visitor_ = initVisitor(visitor);
      if (identity.isDocument(node2)) {
        const cd = visit_(null, node2.contents, visitor_, Object.freeze([node2]));
        if (cd === REMOVE)
          node2.contents = null;
      } else
        visit_(null, node2, visitor_, Object.freeze([]));
    }
    visit2.BREAK = BREAK;
    visit2.SKIP = SKIP;
    visit2.REMOVE = REMOVE;
    function visit_(key, node2, visitor, path11) {
      const ctrl = callVisitor(key, node2, visitor, path11);
      if (identity.isNode(ctrl) || identity.isPair(ctrl)) {
        replaceNode(key, path11, ctrl);
        return visit_(key, ctrl, visitor, path11);
      }
      if (typeof ctrl !== "symbol") {
        if (identity.isCollection(node2)) {
          path11 = Object.freeze(path11.concat(node2));
          for (let i = 0; i < node2.items.length; ++i) {
            const ci = visit_(i, node2.items[i], visitor, path11);
            if (typeof ci === "number")
              i = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              node2.items.splice(i, 1);
              i -= 1;
            }
          }
        } else if (identity.isPair(node2)) {
          path11 = Object.freeze(path11.concat(node2));
          const ck = visit_("key", node2.key, visitor, path11);
          if (ck === BREAK)
            return BREAK;
          else if (ck === REMOVE)
            node2.key = null;
          const cv = visit_("value", node2.value, visitor, path11);
          if (cv === BREAK)
            return BREAK;
          else if (cv === REMOVE)
            node2.value = null;
        }
      }
      return ctrl;
    }
    async function visitAsync(node2, visitor) {
      const visitor_ = initVisitor(visitor);
      if (identity.isDocument(node2)) {
        const cd = await visitAsync_(null, node2.contents, visitor_, Object.freeze([node2]));
        if (cd === REMOVE)
          node2.contents = null;
      } else
        await visitAsync_(null, node2, visitor_, Object.freeze([]));
    }
    visitAsync.BREAK = BREAK;
    visitAsync.SKIP = SKIP;
    visitAsync.REMOVE = REMOVE;
    async function visitAsync_(key, node2, visitor, path11) {
      const ctrl = await callVisitor(key, node2, visitor, path11);
      if (identity.isNode(ctrl) || identity.isPair(ctrl)) {
        replaceNode(key, path11, ctrl);
        return visitAsync_(key, ctrl, visitor, path11);
      }
      if (typeof ctrl !== "symbol") {
        if (identity.isCollection(node2)) {
          path11 = Object.freeze(path11.concat(node2));
          for (let i = 0; i < node2.items.length; ++i) {
            const ci = await visitAsync_(i, node2.items[i], visitor, path11);
            if (typeof ci === "number")
              i = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              node2.items.splice(i, 1);
              i -= 1;
            }
          }
        } else if (identity.isPair(node2)) {
          path11 = Object.freeze(path11.concat(node2));
          const ck = await visitAsync_("key", node2.key, visitor, path11);
          if (ck === BREAK)
            return BREAK;
          else if (ck === REMOVE)
            node2.key = null;
          const cv = await visitAsync_("value", node2.value, visitor, path11);
          if (cv === BREAK)
            return BREAK;
          else if (cv === REMOVE)
            node2.value = null;
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
    function callVisitor(key, node2, visitor, path11) {
      if (typeof visitor === "function")
        return visitor(key, node2, path11);
      if (identity.isMap(node2))
        return visitor.Map?.(key, node2, path11);
      if (identity.isSeq(node2))
        return visitor.Seq?.(key, node2, path11);
      if (identity.isPair(node2))
        return visitor.Pair?.(key, node2, path11);
      if (identity.isScalar(node2))
        return visitor.Scalar?.(key, node2, path11);
      if (identity.isAlias(node2))
        return visitor.Alias?.(key, node2, path11);
      return void 0;
    }
    function replaceNode(key, path11, node2) {
      const parent = path11[path11.length - 1];
      if (identity.isCollection(parent)) {
        parent.items[key] = node2;
      } else if (identity.isPair(parent)) {
        if (key === "key")
          parent.key = node2;
        else
          parent.value = node2;
      } else if (identity.isDocument(parent)) {
        parent.contents = node2;
      } else {
        const pt2 = identity.isAlias(parent) ? "alias" : "scalar";
        throw new Error(`Cannot replace node with ${pt2} parent`);
      }
    }
    exports2.visit = visit2;
    exports2.visitAsync = visitAsync;
  }
});

// node_modules/yaml/dist/doc/directives.js
var require_directives = __commonJS({
  "node_modules/yaml/dist/doc/directives.js"(exports2) {
    "use strict";
    var identity = require_identity();
    var visit2 = require_visit();
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
            const [version2] = parts;
            if (version2 === "1.1" || version2 === "1.2") {
              this.yaml.version = version2;
              return true;
            } else {
              const isValid = /^\d+\.\d+$/.test(version2);
              onError(6, `Unsupported YAML version ${version2}`, isValid);
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
          } catch (error2) {
            onError(String(error2));
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
          visit2.visit(doc.contents, (_key, node2) => {
            if (identity.isNode(node2) && node2.tag)
              tags[node2.tag] = true;
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
    var visit2 = require_visit();
    function anchorIsValid(anchor2) {
      if (/[\x00-\x19\s,[\]{}]/.test(anchor2)) {
        const sa = JSON.stringify(anchor2);
        const msg = `Anchor must not contain whitespace or control characters: ${sa}`;
        throw new Error(msg);
      }
      return true;
    }
    function anchorNames(root) {
      const anchors = /* @__PURE__ */ new Set();
      visit2.visit(root, {
        Value(_key, node2) {
          if (node2.anchor)
            anchors.add(node2.anchor);
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
          const anchor2 = findNewAnchor(prefix, prevAnchors);
          prevAnchors.add(anchor2);
          return anchor2;
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
              const error2 = new Error("Failed to resolve repeated object (this should not happen)");
              error2.source = source;
              throw error2;
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
    var visit2 = require_visit();
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
          visit2.visit(doc, {
            Node: (_key, node2) => {
              if (identity.isAlias(node2) || identity.hasAnchor(node2))
                nodes.push(node2);
            }
          });
          if (ctx)
            ctx.aliasResolveCache = nodes;
        }
        let found = void 0;
        for (const node2 of nodes) {
          if (node2 === this)
            break;
          if (node2.anchor === this.source)
            found = node2;
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
    function getAliasCount(doc, node2, anchors2) {
      if (identity.isAlias(node2)) {
        const source = node2.resolve(doc);
        const anchor2 = anchors2 && source && anchors2.get(source);
        return anchor2 ? anchor2.count * anchor2.aliasCount : 0;
      } else if (identity.isCollection(node2)) {
        let count = 0;
        for (const item of node2.items) {
          const c = getAliasCount(doc, item, anchors2);
          if (c > count)
            count = c;
        }
        return count;
      } else if (identity.isPair(node2)) {
        const kc = getAliasCount(doc, node2.key, anchors2);
        const vc = getAliasCount(doc, node2.value, anchors2);
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
          const node3 = new Scalar.Scalar(value);
          if (ref)
            ref.node = node3;
          return node3;
        }
        tagObj = value instanceof Map ? schema[identity.MAP] : Symbol.iterator in Object(value) ? schema[identity.SEQ] : schema[identity.MAP];
      }
      if (onTagObj) {
        onTagObj(tagObj);
        delete ctx.onTagObj;
      }
      const node2 = tagObj?.createNode ? tagObj.createNode(ctx.schema, value, ctx) : typeof tagObj?.nodeClass?.from === "function" ? tagObj.nodeClass.from(ctx.schema, value, ctx) : new Scalar.Scalar(value);
      if (tagName)
        node2.tag = tagName;
      else if (!tagObj.default)
        node2.tag = tagObj.tag;
      if (ref)
        ref.node = node2;
      return node2;
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
          const node2 = this.get(key, true);
          if (identity.isCollection(node2))
            node2.addIn(rest, value);
          else if (node2 === void 0 && this.schema)
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
        const node2 = this.get(key, true);
        if (identity.isCollection(node2))
          return node2.deleteIn(rest);
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
        const node2 = this.get(key, true);
        if (rest.length === 0)
          return !keepScalar && identity.isScalar(node2) ? node2.value : node2;
        else
          return identity.isCollection(node2) ? node2.getIn(rest, keepScalar) : void 0;
      }
      hasAllNullValues(allowScalar) {
        return this.items.every((node2) => {
          if (!identity.isPair(node2))
            return false;
          const n = node2.value;
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
        const node2 = this.get(key, true);
        return identity.isCollection(node2) ? node2.hasIn(rest) : false;
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
          const node2 = this.get(key, true);
          if (identity.isCollection(node2))
            node2.setIn(rest, value);
          else if (node2 === void 0 && this.schema)
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
    function foldFlowLines(text3, indent, mode = "flow", { indentAtStart, lineWidth = 80, minContentWidth = 20, onFold, onOverflow } = {}) {
      if (!lineWidth || lineWidth < 0)
        return text3;
      if (lineWidth < minContentWidth)
        minContentWidth = 0;
      const endStep = Math.max(1 + minContentWidth, 1 + lineWidth - indent.length);
      if (text3.length <= endStep)
        return text3;
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
        i = consumeMoreIndentedLines(text3, i, indent.length);
        if (i !== -1)
          end = i + endStep;
      }
      for (let ch; ch = text3[i += 1]; ) {
        if (mode === FOLD_QUOTED && ch === "\\") {
          escStart = i;
          switch (text3[i + 1]) {
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
            i = consumeMoreIndentedLines(text3, i, indent.length);
          end = i + indent.length + endStep;
          split = void 0;
        } else {
          if (ch === " " && prev && prev !== " " && prev !== "\n" && prev !== "	") {
            const next = text3[i + 1];
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
                ch = text3[i += 1];
                overflow = true;
              }
              const j2 = i > escEnd + 1 ? i - 2 : escStart - 1;
              if (escapedFolds[j2])
                return text3;
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
        return text3;
      if (onFold)
        onFold();
      let res = text3.slice(0, folds[0]);
      for (let i2 = 0; i2 < folds.length; ++i2) {
        const fold = folds[i2];
        const end2 = folds[i2 + 1] || text3.length;
        if (fold === 0)
          res = `
${indent}${text3.slice(0, end2)}`;
        else {
          if (mode === FOLD_QUOTED && escapedFolds[fold])
            res += `${text3[fold]}\\`;
          res += `
${indent}${text3.slice(fold + 1, end2)}`;
        }
      }
      return res;
    }
    function consumeMoreIndentedLines(text3, i, indent) {
      let end = i;
      let start = i + 1;
      let ch = text3[start];
      while (ch === " " || ch === "	") {
        if (i < start + indent) {
          ch = text3[++i];
        } else {
          do {
            ch = text3[++i];
          } while (ch && ch !== "\n");
          end = i;
          start = i + 1;
          ch = text3[start];
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
    function stringifyProps(node2, tagObj, { anchors: anchors$1, doc }) {
      if (!doc.directives)
        return "";
      const props = [];
      const anchor2 = (identity.isScalar(node2) || identity.isCollection(node2)) && node2.anchor;
      if (anchor2 && anchors.anchorIsValid(anchor2)) {
        anchors$1.add(anchor2);
        props.push(`&${anchor2}`);
      }
      const tag = node2.tag ?? (tagObj.default ? null : tagObj.tag);
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
      const node2 = identity.isNode(item) ? item : ctx.doc.createNode(item, { onTagObj: (o) => tagObj = o });
      tagObj ?? (tagObj = getTagObject(ctx.doc.schema.tags, node2));
      const props = stringifyProps(node2, tagObj, ctx);
      if (props.length > 0)
        ctx.indentAtStart = (ctx.indentAtStart ?? 0) + props.length + 1;
      const str5 = typeof tagObj.stringify === "function" ? tagObj.stringify(node2, ctx, onComment, onChompKeep) : identity.isScalar(node2) ? stringifyString.stringifyString(node2, ctx, onComment, onChompKeep) : node2.toString(ctx, onComment, onChompKeep);
      if (!props)
        return str5;
      return identity.isScalar(node2) || str5[0] === "{" || str5[0] === "[" ? `${props} ${str5}` : `${props}
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
    var merge2 = {
      identify: (value) => value === MERGE_KEY || typeof value === "symbol" && value.description === MERGE_KEY,
      default: "key",
      tag: "tag:yaml.org,2002:merge",
      test: /^<<$/,
      resolve: () => Object.assign(new Scalar.Scalar(Symbol(MERGE_KEY)), {
        addToJSMap: addMergeToJSMap
      }),
      stringify: () => MERGE_KEY
    };
    var isMergeKey = (ctx, key) => (merge2.identify(key) || identity.isScalar(key) && (!key.type || key.type === Scalar.Scalar.PLAIN) && merge2.identify(key.value)) && ctx?.doc.schema.tags.some((tag) => tag.tag === merge2.tag && tag.default);
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
    exports2.merge = merge2;
  }
});

// node_modules/yaml/dist/nodes/addPairToJSMap.js
var require_addPairToJSMap = __commonJS({
  "node_modules/yaml/dist/nodes/addPairToJSMap.js"(exports2) {
    "use strict";
    var log = require_log();
    var merge2 = require_merge();
    var stringify2 = require_stringify();
    var identity = require_identity();
    var toJS = require_toJS();
    function addPairToJSMap(ctx, map, { key, value }) {
      if (identity.isNode(key) && key.addToJSMap)
        key.addToJSMap(ctx, map, value);
      else if (merge2.isMergeKey(ctx, key))
        merge2.addMergeToJSMap(ctx, map, value);
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
        for (const node2 of ctx.anchors.keys())
          strCtx.anchors.add(node2.anchor);
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
        let str6 = stringify2.stringify(item, itemCtx, () => comment2 = null, () => chompKeep = true);
        if (comment2)
          str6 += stringifyComment.lineComment(str6, itemIndent, commentString(comment2));
        if (chompKeep && comment2)
          chompKeep = false;
        lines2.push(blockItemPrefix + str6);
      }
      let str5;
      if (lines2.length === 0) {
        str5 = flowChars.start + flowChars.end;
      } else {
        str5 = lines2[0];
        for (let i = 1; i < lines2.length; ++i) {
          const line3 = lines2[i];
          str5 += line3 ? `
${indent}${line3}` : "\n";
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
        let str5 = stringify2.stringify(item, itemCtx, () => comment = null);
        reqNewline || (reqNewline = lines2.length > linesAtValue || str5.includes("\n"));
        if (i < items.length - 1) {
          str5 += ",";
        } else if (ctx.options.trailingComma) {
          if (ctx.options.lineWidth > 0) {
            reqNewline || (reqNewline = lines2.reduce((sum, line3) => sum + line3.length + 2, 2) + (str5.length + 2) > ctx.options.lineWidth);
          }
          if (reqNewline) {
            str5 += ",";
          }
        }
        if (comment)
          str5 += stringifyComment.lineComment(str5, itemIndent, commentString(comment));
        lines2.push(str5);
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
          let str5 = start;
          for (const line3 of lines2)
            str5 += line3 ? `
${indentStep}${indent}${line3}` : "\n";
          return `${str5}
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
        const node2 = it2?.value;
        return (!keepScalar && identity.isScalar(node2) ? node2.value : node2) ?? void 0;
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
    var string3 = {
      identify: (value) => typeof value === "string",
      default: true,
      tag: "tag:yaml.org,2002:str",
      resolve: (str5) => str5,
      stringify(item, ctx, onComment, onChompKeep) {
        ctx = Object.assign({ actualString: true }, ctx);
        return stringifyString.stringifyString(item, ctx, onComment, onChompKeep);
      }
    };
    exports2.string = string3;
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
      stringify(node2) {
        const num = Number(node2.value);
        return isFinite(num) ? num.toExponential() : stringifyNumber.stringifyNumber(node2);
      }
    };
    var float = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^[-+]?(?:\.[0-9]+|[0-9]+\.[0-9]*)$/,
      resolve(str5) {
        const node2 = new Scalar.Scalar(parseFloat(str5));
        const dot = str5.indexOf(".");
        if (dot !== -1 && str5[str5.length - 1] === "0")
          node2.minFractionDigits = str5.length - dot - 1;
        return node2;
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
    function intStringify(node2, radix, prefix) {
      const { value } = node2;
      if (intIdentify(value) && value >= 0)
        return prefix + value.toString(radix);
      return stringifyNumber.stringifyNumber(node2);
    }
    var intOct = {
      identify: (value) => intIdentify(value) && value >= 0,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "OCT",
      test: /^0o[0-7]+$/,
      resolve: (str5, _onError, opt) => intResolve(str5, 2, 8, opt),
      stringify: (node2) => intStringify(node2, 8, "0o")
    };
    var int4 = {
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
      stringify: (node2) => intStringify(node2, 16, "0x")
    };
    exports2.int = int4;
    exports2.intHex = intHex;
    exports2.intOct = intOct;
  }
});

// node_modules/yaml/dist/schema/core/schema.js
var require_schema = __commonJS({
  "node_modules/yaml/dist/schema/core/schema.js"(exports2) {
    "use strict";
    var map = require_map();
    var _null3 = require_null();
    var seq = require_seq();
    var string3 = require_string();
    var bool = require_bool();
    var float = require_float();
    var int4 = require_int();
    var schema = [
      map.map,
      seq.seq,
      string3.string,
      _null3.nullTag,
      bool.boolTag,
      int4.intOct,
      int4.int,
      int4.intHex,
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
          let s = "";
          for (let i = 0; i < buf.length; ++i)
            s += String.fromCharCode(buf[i]);
          str5 = btoa(s);
        } else {
          throw new Error("This environment does not support writing binary tags; either Buffer or btoa is required");
        }
        type ?? (type = Scalar.Scalar.BLOCK_LITERAL);
        if (type !== Scalar.Scalar.QUOTE_DOUBLE) {
          const lineWidth = Math.max(ctx.options.lineWidth - ctx.indent.length, ctx.options.minContentWidth);
          const n = Math.ceil(str5.length / lineWidth);
          const lines2 = new Array(n);
          for (let i = 0, o = 0; i < n; ++i, o += lineWidth) {
            lines2[i] = str5.substr(o, lineWidth);
          }
          str5 = lines2.join(type === Scalar.Scalar.BLOCK_LITERAL ? "\n" : " ");
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
      stringify(node2) {
        const num = Number(node2.value);
        return isFinite(num) ? num.toExponential() : stringifyNumber.stringifyNumber(node2);
      }
    };
    var float = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^[-+]?(?:[0-9][0-9_]*)?\.[0-9_]*$/,
      resolve(str5) {
        const node2 = new Scalar.Scalar(parseFloat(str5.replace(/_/g, "")));
        const dot = str5.indexOf(".");
        if (dot !== -1) {
          const f = str5.substring(dot + 1).replace(/_/g, "");
          if (f[f.length - 1] === "0")
            node2.minFractionDigits = f.length;
        }
        return node2;
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
    function intStringify(node2, radix, prefix) {
      const { value } = node2;
      if (intIdentify(value)) {
        const str5 = value.toString(radix);
        return value < 0 ? "-" + prefix + str5.substr(1) : prefix + str5;
      }
      return stringifyNumber.stringifyNumber(node2);
    }
    var intBin = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "BIN",
      test: /^[-+]?0b[0-1_]+$/,
      resolve: (str5, _onError, opt) => intResolve(str5, 2, 2, opt),
      stringify: (node2) => intStringify(node2, 2, "0b")
    };
    var intOct = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "OCT",
      test: /^[-+]?0[0-7_]+$/,
      resolve: (str5, _onError, opt) => intResolve(str5, 1, 8, opt),
      stringify: (node2) => intStringify(node2, 8, "0")
    };
    var int4 = {
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
      stringify: (node2) => intStringify(node2, 16, "0x")
    };
    exports2.int = int4;
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
    function parseSexagesimal(str5, asBigInt) {
      const sign = str5[0];
      const parts = sign === "-" || sign === "+" ? str5.substring(1) : str5;
      const num = (n) => asBigInt ? BigInt(n) : Number(n);
      const res = parts.replace(/_/g, "").split(":").reduce((res2, p) => res2 * num(60) + num(p), num(0));
      return sign === "-" ? num(-1) * res : res;
    }
    function stringifySexagesimal(node2) {
      let { value } = node2;
      let num = (n) => n;
      if (typeof value === "bigint")
        num = (n) => BigInt(n);
      else if (isNaN(value) || !isFinite(value))
        return stringifyNumber.stringifyNumber(node2);
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
        let date3 = Date.UTC(year, month - 1, day, hour || 0, minute || 0, second || 0, millisec);
        const tz = match[8];
        if (tz && tz !== "Z") {
          let d = parseSexagesimal(tz, false);
          if (Math.abs(d) < 30)
            d *= 60;
          date3 -= 6e4 * d;
        }
        return new Date(date3);
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
    var _null3 = require_null();
    var seq = require_seq();
    var string3 = require_string();
    var binary = require_binary();
    var bool = require_bool2();
    var float = require_float2();
    var int4 = require_int2();
    var merge2 = require_merge();
    var omap = require_omap();
    var pairs = require_pairs();
    var set = require_set();
    var timestamp = require_timestamp();
    var schema = [
      map.map,
      seq.seq,
      string3.string,
      _null3.nullTag,
      bool.trueTag,
      bool.falseTag,
      int4.intBin,
      int4.intOct,
      int4.int,
      int4.intHex,
      float.floatNaN,
      float.floatExp,
      float.float,
      binary.binary,
      merge2.merge,
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
    var _null3 = require_null();
    var seq = require_seq();
    var string3 = require_string();
    var bool = require_bool();
    var float = require_float();
    var int4 = require_int();
    var schema = require_schema();
    var schema$1 = require_schema2();
    var binary = require_binary();
    var merge2 = require_merge();
    var omap = require_omap();
    var pairs = require_pairs();
    var schema$2 = require_schema3();
    var set = require_set();
    var timestamp = require_timestamp();
    var schemas5 = /* @__PURE__ */ new Map([
      ["core", schema.schema],
      ["failsafe", [map.map, seq.seq, string3.string]],
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
      int: int4.int,
      intHex: int4.intHex,
      intOct: int4.intOct,
      intTime: timestamp.intTime,
      map: map.map,
      merge: merge2.merge,
      null: _null3.nullTag,
      omap: omap.omap,
      pairs: pairs.pairs,
      seq: seq.seq,
      set: set.set,
      timestamp: timestamp.timestamp
    };
    var coreKnownTags = {
      "tag:yaml.org,2002:binary": binary.binary,
      "tag:yaml.org,2002:merge": merge2.merge,
      "tag:yaml.org,2002:omap": omap.omap,
      "tag:yaml.org,2002:pairs": pairs.pairs,
      "tag:yaml.org,2002:set": set.set,
      "tag:yaml.org,2002:timestamp": timestamp.timestamp
    };
    function getTags(customTags, schemaName, addMergeTag) {
      const schemaTags = schemas5.get(schemaName);
      if (schemaTags && !customTags) {
        return addMergeTag && !schemaTags.includes(merge2.merge) ? schemaTags.concat(merge2.merge) : schemaTags.slice();
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
        tags = tags.concat(merge2.merge);
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
    var string3 = require_string();
    var tags = require_tags();
    var sortMapEntriesByKey = (a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    var Schema = class _Schema {
      constructor({ compat, customTags, merge: merge2, resolveKnownTags, schema, sortMapEntries, toStringDefaults }) {
        this.compat = Array.isArray(compat) ? tags.getTags(compat, "compat") : compat ? tags.getTags(null, compat) : null;
        this.name = typeof schema === "string" && schema || "core";
        this.knownTags = resolveKnownTags ? tags.coreKnownTags : {};
        this.tags = tags.getTags(customTags, this.name, merge2);
        this.toStringOptions = toStringDefaults ?? null;
        Object.defineProperty(this, identity.MAP, { value: map.map });
        Object.defineProperty(this, identity.SCALAR, { value: string3.string });
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
        let { version: version2 } = opt;
        if (options?._directives) {
          this.directives = options._directives.atDocument();
          if (this.directives.yaml.explicit)
            version2 = this.directives.yaml.version;
        } else
          this.directives = new directives.Directives({ version: version2 });
        this.setSchema(version2, options);
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
      createAlias(node2, name) {
        if (!node2.anchor) {
          const prev = anchors.anchorNames(this);
          node2.anchor = // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
          !name || prev.has(name) ? anchors.findNewAnchor(name || "a", prev) : name;
        }
        return new Alias.Alias(node2.anchor);
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
        const node2 = createNode.createNode(value, tag, ctx);
        if (flow && identity.isCollection(node2))
          node2.flow = true;
        setAnchors();
        return node2;
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
      setSchema(version2, options = {}) {
        if (typeof version2 === "number")
          version2 = String(version2);
        let opt;
        switch (version2) {
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
              this.directives.yaml.version = version2;
            else
              this.directives = new directives.Directives({ version: version2 });
            opt = { resolveKnownTags: true, schema: "core" };
            break;
          case null:
            if (this.directives)
              delete this.directives;
            opt = null;
            break;
          default: {
            const sv = JSON.stringify(version2);
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
    var prettifyError = (src, lc) => (error2) => {
      if (error2.pos[0] === -1)
        return;
      error2.linePos = error2.pos.map((pos) => lc.linePos(pos));
      const { line: line3, col } = error2.linePos[0];
      error2.message += ` at line ${line3}, column ${col}`;
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
        const end = error2.linePos[1];
        if (end?.line === line3 && end.col > col) {
          count = Math.max(1, Math.min(end.col - col, 80 - ci));
        }
        const pointer = " ".repeat(ci) + "^".repeat(count);
        error2.message += `:

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
      let anchor2 = null;
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
            if (anchor2 || tag)
              newlineAfterProp = token;
            hasSpace = true;
            break;
          case "anchor":
            if (anchor2)
              onError(token, "MULTIPLE_ANCHORS", "A node can have at most one anchor");
            if (token.source.endsWith(":"))
              onError(token.offset + token.source.length - 1, "BAD_ALIAS", "Anchor ending in : is ambiguous", true);
            anchor2 = token;
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
            if (anchor2 || tag)
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
        anchor: anchor2,
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
        const node2 = value ? composeNode(ctx, value, props, onError) : composeEmptyNode(ctx, props.end, start, null, props, onError);
        if (ctx.schema.compat)
          utilFlowIndentCheck.flowIndentCheck(bs.indent, value, onError);
        offset = node2.range[2];
        seq.items.push(node2);
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
      const isMap2 = fc.start.source === "{";
      const fcName = isMap2 ? "flow map" : "flow sequence";
      const NodeClass = tag?.nodeClass ?? (isMap2 ? YAMLMap.YAMLMap : YAMLSeq.YAMLSeq);
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
          if (!isMap2 && ctx.options.strict && utilContainsNewline.containsNewline(key))
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
        if (!isMap2 && !sep && !props.found) {
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
            if (!isMap2 && !props.found && ctx.options.strict) {
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
          if (isMap2) {
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
      const expectedEnd = isMap2 ? "}" : "]";
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
        const { anchor: anchor2, newlineAfterProp: nl } = props;
        const lastProp = anchor2 && tagToken ? anchor2.offset > tagToken.offset ? anchor2 : tagToken : anchor2 ?? tagToken;
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
      const node2 = identity.isNode(res) ? res : new Scalar.Scalar(res);
      node2.range = coll.range;
      node2.tag = tagName;
      if (tag?.format)
        node2.format = tag.format;
      return node2;
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
      let error2 = -1;
      for (let i = 1; i < source.length; ++i) {
        const ch = source[i];
        if (!chomp && (ch === "-" || ch === "+"))
          chomp = ch;
        else {
          const n = Number(ch);
          if (!indent && n)
            indent = n;
          else if (error2 === -1)
            error2 = offset + i;
        }
      }
      if (error2 !== -1)
        onError(error2, "UNEXPECTED_TOKEN", `Block scalar header includes extra characters: ${source}`);
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
      } catch (error2) {
        const msg = error2 instanceof Error ? error2.message : String(error2);
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
      const { spaceBefore, comment, anchor: anchor2, tag } = props;
      let node2;
      let isSrcToken = true;
      switch (token.type) {
        case "alias":
          node2 = composeAlias(ctx, token, onError);
          if (anchor2 || tag)
            onError(token, "ALIAS_PROPS", "An alias node must not specify any properties");
          break;
        case "scalar":
        case "single-quoted-scalar":
        case "double-quoted-scalar":
        case "block-scalar":
          node2 = composeScalar.composeScalar(ctx, token, tag, onError);
          if (anchor2)
            node2.anchor = anchor2.source.substring(1);
          break;
        case "block-map":
        case "block-seq":
        case "flow-collection":
          try {
            node2 = composeCollection.composeCollection(CN, ctx, token, props, onError);
            if (anchor2)
              node2.anchor = anchor2.source.substring(1);
          } catch (error2) {
            const message = error2 instanceof Error ? error2.message : String(error2);
            onError(token, "RESOURCE_EXHAUSTION", message);
          }
          break;
        default: {
          const message = token.type === "error" ? token.message : `Unsupported token (type: ${token.type})`;
          onError(token, "UNEXPECTED_TOKEN", message);
          isSrcToken = false;
        }
      }
      node2 ?? (node2 = composeEmptyNode(ctx, token.offset, void 0, null, props, onError));
      if (anchor2 && node2.anchor === "")
        onError(anchor2, "BAD_ALIAS", "Anchor cannot be an empty string");
      if (atKey && ctx.options.stringKeys && (!identity.isScalar(node2) || typeof node2.value !== "string" || node2.tag && node2.tag !== "tag:yaml.org,2002:str")) {
        const msg = "With stringKeys, all keys must be strings";
        onError(tag ?? token, "NON_STRING_KEY", msg);
      }
      if (spaceBefore)
        node2.spaceBefore = true;
      if (comment) {
        if (token.type === "scalar" && token.source === "")
          node2.comment = comment;
        else
          node2.commentBefore = comment;
      }
      if (ctx.options.keepSourceTokens && isSrcToken)
        node2.srcToken = token;
      return node2;
    }
    function composeEmptyNode(ctx, offset, before, pos, { spaceBefore, comment, anchor: anchor2, tag, end }, onError) {
      const token = {
        type: "scalar",
        offset: utilEmptyScalarPosition.emptyScalarPosition(offset, before, pos),
        indent: -1,
        source: ""
      };
      const node2 = composeScalar.composeScalar(ctx, token, tag, onError);
      if (anchor2) {
        node2.anchor = anchor2.source.substring(1);
        if (node2.anchor === "")
          onError(anchor2, "BAD_ALIAS", "Anchor cannot be an empty string");
      }
      if (spaceBefore)
        node2.spaceBefore = true;
      if (comment) {
        node2.comment = comment;
        node2.range[2] = end;
      }
      return node2;
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
            const error2 = new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", msg);
            if (this.atDirectives || !this.doc)
              this.errors.push(error2);
            else
              this.doc.errors.push(error2);
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
    function visit2(cst, visitor) {
      if ("type" in cst && cst.type === "document")
        cst = { start: cst.start, value: cst.value };
      _visit(Object.freeze([]), cst, visitor);
    }
    visit2.BREAK = BREAK;
    visit2.SKIP = SKIP;
    visit2.REMOVE = REMOVE;
    visit2.itemAtPath = (cst, path11) => {
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
    visit2.parentCollection = (cst, path11) => {
      const parent = visit2.itemAtPath(cst, path11.slice(0, -1));
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
    exports2.visit = visit2;
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
    var isScalar2 = (token) => !!token && (token.type === "scalar" || token.type === "single-quoted-scalar" || token.type === "double-quoted-scalar" || token.type === "block-scalar");
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
    exports2.isScalar = isScalar2;
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
      *pop(error2) {
        const token = error2 ?? this.stack.pop();
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
    var visit2 = require_visit();
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
    exports2.visit = visit2.visit;
    exports2.visitAsync = visit2.visitAsync;
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

// node_modules/zod/v4/core/util.js
var util_exports = {};
__export(util_exports, {
  BIGINT_FORMAT_RANGES: () => BIGINT_FORMAT_RANGES,
  CONSTANT_CATCH: () => CONSTANT_CATCH,
  Class: () => Class,
  NUMBER_FORMAT_RANGES: () => NUMBER_FORMAT_RANGES,
  aborted: () => aborted,
  allowsEval: () => allowsEval,
  assert: () => assert,
  assertEqual: () => assertEqual,
  assertIs: () => assertIs,
  assertNever: () => assertNever,
  assertNotEqual: () => assertNotEqual,
  assignProp: () => assignProp,
  attachSchema: () => attachSchema,
  base64ToUint8Array: () => base64ToUint8Array,
  base64urlToUint8Array: () => base64urlToUint8Array,
  cached: () => cached,
  captureStackTrace: () => captureStackTrace,
  cleanEnum: () => cleanEnum,
  cleanRegex: () => cleanRegex,
  clone: () => clone,
  cloneDef: () => cloneDef,
  codePointLength: () => codePointLength,
  constantCatch: () => constantCatch,
  createTransparentProxy: () => createTransparentProxy,
  defineLazy: () => defineLazy,
  defineLazyInternal: () => defineLazyInternal,
  derived: () => derived,
  esc: () => esc,
  escapeRegex: () => escapeRegex,
  explicitlyAborted: () => explicitlyAborted,
  extend: () => extend,
  finalizeIssue: () => finalizeIssue,
  floatSafeRemainder: () => floatSafeRemainder,
  getElementAtPath: () => getElementAtPath,
  getEnumValues: () => getEnumValues,
  getLengthableOrigin: () => getLengthableOrigin,
  getParsedType: () => getParsedType,
  getSizableOrigin: () => getSizableOrigin,
  hexToUint8Array: () => hexToUint8Array,
  hide: () => hide,
  installLazyProp: () => installLazyProp,
  isObject: () => isObject,
  isPlainObject: () => isPlainObject,
  issue: () => issue,
  joinValues: () => joinValues,
  jsonStringifyReplacer: () => jsonStringifyReplacer,
  members: () => members,
  merge: () => merge,
  mergeDefs: () => mergeDefs,
  normalizeParams: () => normalizeParams,
  nullish: () => nullish,
  numKeys: () => numKeys,
  objectClone: () => objectClone,
  omit: () => omit,
  optionalKeys: () => optionalKeys,
  own: () => own,
  parsedType: () => parsedType,
  partial: () => partial,
  pick: () => pick,
  prefixIssues: () => prefixIssues,
  primitiveTypes: () => primitiveTypes,
  promiseAllObject: () => promiseAllObject,
  propertyKeyTypes: () => propertyKeyTypes,
  randomString: () => randomString,
  rawShape: () => rawShape,
  required: () => required,
  safeExtend: () => safeExtend,
  shallowClone: () => shallowClone,
  sizeCaps: () => sizeCaps,
  slugify: () => slugify,
  stringifyPrimitive: () => stringifyPrimitive,
  toZod: () => toZod,
  uint8ArrayToBase64: () => uint8ArrayToBase64,
  uint8ArrayToBase64url: () => uint8ArrayToBase64url,
  uint8ArrayToHex: () => uint8ArrayToHex,
  unwrapMessage: () => unwrapMessage
});
function assertEqual(val) {
  return val;
}
function assertNotEqual(val) {
  return val;
}
function toZod() {
  return (schema) => schema;
}
function assertIs(_arg) {
}
function assertNever(_x) {
  throw new Error("Unexpected value in exhaustive check");
}
function assert(_2) {
}
function getEnumValues(entries2) {
  const numericValues = Object.values(entries2).filter((v) => typeof v === "number");
  const values = Object.entries(entries2).filter(([k2, _2]) => numericValues.indexOf(+k2) === -1).map(([_2, v]) => v);
  return values;
}
function joinValues(array2, separator = "|") {
  return array2.map((val) => stringifyPrimitive(val)).join(separator);
}
function jsonStringifyReplacer(_2, value) {
  if (typeof value === "bigint")
    return value.toString();
  return value;
}
var Cached = class {
  constructor(getter) {
    this._getter = getter;
    this._value = void 0;
  }
  get value() {
    const getter = this._getter;
    if (getter !== void 0) {
      this._value = getter();
      this._getter = void 0;
    }
    return this._value;
  }
};
function cached(getter) {
  return new Cached(getter);
}
function nullish(input) {
  return input === null || input === void 0;
}
function cleanRegex(source) {
  const start = source.startsWith("^") ? 1 : 0;
  const end = source.endsWith("$") ? source.length - 1 : source.length;
  return source.slice(start, end);
}
function floatSafeRemainder(val, step) {
  const ratio = val / step;
  const roundedRatio = Math.round(ratio);
  const tolerance = 4 * Number.EPSILON * Math.max(Math.abs(ratio), 1);
  if (Math.abs(ratio - roundedRatio) < tolerance)
    return 0;
  return ratio - roundedRatio;
}
var EVALUATING = /* @__PURE__ */ Symbol("evaluating");
function defineLazy(object2, key, getter) {
  let value = void 0;
  Object.defineProperty(object2, key, {
    get() {
      if (value === EVALUATING) {
        return void 0;
      }
      if (value === void 0) {
        value = EVALUATING;
        value = getter();
      }
      return value;
    },
    set(v) {
      Object.defineProperty(object2, key, {
        value: v
        // configurable: true,
      });
    },
    configurable: true
  });
}
function objectClone(obj) {
  return Object.create(Object.getPrototypeOf(obj), Object.getOwnPropertyDescriptors(obj));
}
function assignProp(target, prop, value) {
  Object.defineProperty(target, prop, {
    value,
    writable: true,
    enumerable: true,
    configurable: true
  });
}
function rawShape(def) {
  const desc = Object.getOwnPropertyDescriptor(def, "shape");
  return desc?.get ? desc.get.raw : desc?.value;
}
function sourceShape(schema) {
  return rawShape(schema._zod.def) ?? schema._zod.def.shape;
}
function deferProp(target, key, getter) {
  Object.defineProperty(target, key, {
    get() {
      const value = getter();
      assignProp(this, key, value);
      return value;
    },
    enumerable: true,
    configurable: true
  });
}
function putProp(target, key, value) {
  if (key in target)
    assignProp(target, key, value);
  else
    target[key] = value;
}
function mirrorShape(target, source, keys, wrap) {
  const raw = sourceShape(source);
  for (const key of keys) {
    const desc = Object.getOwnPropertyDescriptor(raw, key);
    if (!desc.enumerable)
      continue;
    if (desc.get) {
      deferProp(target, key, () => {
        const value = source._zod.def.shape[key];
        return wrap ? wrap(value, key) : value;
      });
    } else
      putProp(target, key, wrap ? wrap(desc.value, key) : desc.value);
  }
}
function mirrorProps(target, source) {
  for (const key of Reflect.ownKeys(source)) {
    const desc = Object.getOwnPropertyDescriptor(source, key);
    if (!desc.enumerable)
      continue;
    if (desc.get)
      deferProp(target, key, () => source[key]);
    else
      putProp(target, key, desc.value);
  }
}
function mergeDefs(...defs) {
  const mergedDescriptors = {};
  for (const def of defs) {
    const descriptors = Object.getOwnPropertyDescriptors(def);
    Object.assign(mergedDescriptors, descriptors);
  }
  return Object.defineProperties({}, mergedDescriptors);
}
function cloneDef(schema) {
  return mergeDefs(schema._zod.def);
}
function getElementAtPath(obj, path11) {
  if (!path11)
    return obj;
  return path11.reduce((acc, key) => acc?.[key], obj);
}
function promiseAllObject(promisesObj) {
  const keys = Object.keys(promisesObj);
  const promises = keys.map((key) => promisesObj[key]);
  return Promise.all(promises).then((results) => {
    const resolvedObj = {};
    for (let i = 0; i < keys.length; i++) {
      resolvedObj[keys[i]] = results[i];
    }
    return resolvedObj;
  });
}
function randomString(length = 10) {
  const chars = "abcdefghijklmnopqrstuvwxyz";
  let str5 = "";
  for (let i = 0; i < length; i++) {
    str5 += chars[Math.floor(Math.random() * chars.length)];
  }
  return str5;
}
function esc(str5) {
  return JSON.stringify(str5);
}
function slugify(input) {
  return input.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
}
var captureStackTrace = "captureStackTrace" in Error ? Error.captureStackTrace : (..._args) => {
};
function isObject(data) {
  return typeof data === "object" && data !== null && !Array.isArray(data);
}
var allowsEval = /* @__PURE__ */ cached(() => {
  if (globalConfig.jitless) {
    return false;
  }
  if (typeof navigator !== "undefined" && navigator?.userAgent?.includes("Cloudflare")) {
    return false;
  }
  try {
    const F2 = Function;
    new F2("");
    return true;
  } catch (_2) {
    return false;
  }
});
function isPlainObject(o) {
  if (isObject(o) === false)
    return false;
  const ctor = o.constructor;
  if (ctor === void 0)
    return true;
  if (typeof ctor !== "function")
    return true;
  const prot = ctor.prototype;
  if (isObject(prot) === false)
    return false;
  if (Object.prototype.hasOwnProperty.call(prot, "isPrototypeOf") === false) {
    return false;
  }
  return true;
}
function shallowClone(o) {
  if (isPlainObject(o))
    return { ...o };
  if (Array.isArray(o))
    return [...o];
  if (o instanceof Map)
    return new Map(o);
  if (o instanceof Set)
    return new Set(o);
  return o;
}
function numKeys(data) {
  let keyCount = 0;
  for (const key in data) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      keyCount++;
    }
  }
  return keyCount;
}
var getParsedType = (data) => {
  const t = typeof data;
  switch (t) {
    case "undefined":
      return "undefined";
    case "string":
      return "string";
    case "number":
      return Number.isNaN(data) ? "nan" : "number";
    case "boolean":
      return "boolean";
    case "function":
      return "function";
    case "bigint":
      return "bigint";
    case "symbol":
      return "symbol";
    case "object":
      if (Array.isArray(data)) {
        return "array";
      }
      if (data === null) {
        return "null";
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return "promise";
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return "map";
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return "set";
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return "date";
      }
      if (typeof File !== "undefined" && data instanceof File) {
        return "file";
      }
      return "object";
    default:
      throw new Error(`Unknown data type: ${t}`);
  }
};
var propertyKeyTypes = /* @__PURE__ */ new Set(["string", "number", "symbol"]);
var primitiveTypes = /* @__PURE__ */ new Set([
  "string",
  "number",
  "bigint",
  "boolean",
  "symbol",
  "undefined"
]);
function escapeRegex(str5) {
  return str5.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function clone(inst, def, params) {
  const cl = new inst._zod.constr(def ?? inst._zod.def);
  if (!def || params?.parent)
    cl._zod.parent = inst;
  return cl;
}
function normalizeParams(_params) {
  const params = _params;
  if (!params)
    return {};
  if (typeof params === "string")
    return { error: () => params };
  if (params?.message !== void 0) {
    if (params?.error !== void 0)
      throw new Error("Cannot specify both `message` and `error` params");
    params.error = params.message;
  }
  delete params.message;
  if (typeof params.error === "string")
    return { ...params, error: () => params.error };
  return params;
}
function createTransparentProxy(getter) {
  let target;
  return new Proxy({}, {
    get(_2, prop, receiver) {
      target ?? (target = getter());
      return Reflect.get(target, prop, receiver);
    },
    set(_2, prop, value, receiver) {
      target ?? (target = getter());
      return Reflect.set(target, prop, value, receiver);
    },
    has(_2, prop) {
      target ?? (target = getter());
      return Reflect.has(target, prop);
    },
    deleteProperty(_2, prop) {
      target ?? (target = getter());
      return Reflect.deleteProperty(target, prop);
    },
    ownKeys(_2) {
      target ?? (target = getter());
      return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor(_2, prop) {
      target ?? (target = getter());
      return Reflect.getOwnPropertyDescriptor(target, prop);
    },
    defineProperty(_2, prop, descriptor) {
      target ?? (target = getter());
      return Reflect.defineProperty(target, prop, descriptor);
    }
  });
}
function stringifyPrimitive(value) {
  if (typeof value === "bigint")
    return value.toString() + "n";
  if (typeof value === "string")
    return `"${value}"`;
  return `${value}`;
}
function optionalKeys(shape) {
  return Object.keys(shape).filter((k2) => {
    return shape[k2]._zod.optin !== void 0 && shape[k2]._zod.optout === "optional";
  });
}
var NUMBER_FORMAT_RANGES = /* @__PURE__ */ (() => ({
  safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  int32: [-2147483648, 2147483647],
  uint32: [0, 4294967295],
  float32: [-34028234663852886e22, 34028234663852886e22],
  float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
}))();
var BIGINT_FORMAT_RANGES = {
  int64: [/* @__PURE__ */ BigInt("-9223372036854775808"), /* @__PURE__ */ BigInt("9223372036854775807")],
  uint64: [/* @__PURE__ */ BigInt(0), /* @__PURE__ */ BigInt("18446744073709551615")]
};
function pick(schema, mask) {
  const currDef = schema._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(".pick() cannot be used on object schemas containing refinements");
  }
  const newShape = {};
  mirrorShape(newShape, schema, maskedKeys(schema, mask));
  return clone(schema, mergeDefs(currDef, { shape: newShape, checks: [] }));
}
function maskedKeys(schema, mask) {
  const raw = sourceShape(schema);
  const keys = [];
  for (const key of Reflect.ownKeys(mask)) {
    if (!Object.getOwnPropertyDescriptor(raw, key)?.enumerable) {
      throw new Error(`Unrecognized key: "${String(key)}"`);
    }
    if (mask[key])
      keys.push(key);
  }
  return keys;
}
function omit(schema, mask) {
  const currDef = schema._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(".omit() cannot be used on object schemas containing refinements");
  }
  const omitted = new Set(maskedKeys(schema, mask));
  const newShape = {};
  mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)).filter((key) => !omitted.has(key)));
  return clone(schema, mergeDefs(currDef, { shape: newShape, checks: [] }));
}
function extend(schema, shape) {
  if (!isPlainObject(shape)) {
    throw new Error("Invalid input to extend: expected a plain object");
  }
  const checks = schema._zod.def.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    const existingShape = sourceShape(schema);
    for (const key of Reflect.ownKeys(shape)) {
      if (Object.getOwnPropertyDescriptor(existingShape, key) !== void 0) {
        throw new Error("Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.");
      }
    }
  }
  return clone(schema, mergeDefs(schema._zod.def, { shape: extended(schema, shape) }));
}
function extended(schema, shape) {
  const newShape = {};
  mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)));
  mirrorProps(newShape, shape);
  return newShape;
}
function safeExtend(schema, shape) {
  if (!isPlainObject(shape)) {
    throw new Error("Invalid input to safeExtend: expected a plain object");
  }
  return clone(schema, mergeDefs(schema._zod.def, { shape: extended(schema, shape) }));
}
function merge(a, b) {
  if (!b?._zod?.def) {
    throw new Error("Invalid input to merge: expected an object schema. To merge a plain shape, use `.extend()`.");
  }
  if (a._zod.def.checks?.length) {
    throw new Error(".merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.");
  }
  const newShape = {};
  mirrorShape(newShape, a, Reflect.ownKeys(sourceShape(a)));
  mirrorShape(newShape, b, Reflect.ownKeys(sourceShape(b)));
  const def = mergeDefs(a._zod.def, {
    shape: newShape,
    get catchall() {
      return b._zod.def.catchall;
    },
    checks: b._zod.def.checks ?? []
  });
  return clone(a, def);
}
function partial(Class2, schema, mask, name = "partial") {
  const currDef = schema._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(`.${name}() cannot be used on object schemas containing refinements`);
  }
  const selected = mask ? new Set(maskedKeys(schema, mask)) : void 0;
  const newShape = {};
  mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)), Class2 && ((value, key) => selected && !selected.has(key) ? value : new Class2({ type: "optional", innerType: value })));
  return clone(schema, mergeDefs(schema._zod.def, { shape: newShape, checks: [] }));
}
function required(Class2, schema, mask) {
  const selected = mask ? new Set(maskedKeys(schema, mask)) : void 0;
  const newShape = {};
  mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)), (value, key) => (
    // overwrite with non-optional
    selected && !selected.has(key) ? value : new Class2({ type: "nonoptional", innerType: value })
  ));
  return clone(schema, mergeDefs(schema._zod.def, { shape: newShape }));
}
function aborted(x2, startIndex = 0) {
  if (x2.aborted === true)
    return true;
  for (let i = startIndex; i < x2.issues.length; i++) {
    if (x2.issues[i]?.continue !== true) {
      return true;
    }
  }
  return false;
}
function explicitlyAborted(x2, startIndex = 0) {
  if (x2.aborted === true)
    return true;
  for (let i = startIndex; i < x2.issues.length; i++) {
    if (x2.issues[i]?.continue === false) {
      return true;
    }
  }
  return false;
}
function prefixIssues(path11, issues) {
  return issues.map((iss) => {
    var _a3;
    (_a3 = iss).path ?? (_a3.path = []);
    iss.path.unshift(path11);
    return iss;
  });
}
function unwrapMessage(message) {
  return typeof message === "string" ? message : message?.message;
}
function sizeCaps(defChecks) {
  const caps = [];
  for (const ch of defChecks ?? []) {
    const d = ch._zod.def;
    if (!/_(length|size)$|_equals$/.test(d.check))
      break;
    const max = d.maximum ?? d.length ?? d.size;
    if (max >= 0)
      caps.push([max, ch]);
  }
  return caps;
}
function attachSchema(issues, start, inst) {
  var _a3;
  for (let i = start; i < issues.length; i++) {
    (_a3 = issues[i]).schema ?? (_a3.schema = inst);
  }
}
function finalizeIssue(iss, ctx, config2) {
  var _a3;
  const traits = iss.inst?._zod?.traits;
  if (traits?.has("$ZodType")) {
    if (traits.has("$ZodCheck"))
      (_a3 = iss).schema ?? (_a3.schema = iss.inst);
    else
      iss.schema = iss.inst;
  }
  const schemaError = iss.schema !== iss.inst ? iss.schema?._zod.def?.error : void 0;
  const message = iss.message ? iss.message : unwrapMessage(iss.inst?._zod.def?.error?.(iss)) ?? unwrapMessage(schemaError?.(iss)) ?? unwrapMessage(ctx?.error?.(iss)) ?? unwrapMessage(config2.customError?.(iss)) ?? unwrapMessage(config2.localeError?.(iss)) ?? "Invalid input";
  const full = {};
  for (const k2 of Object.keys(iss)) {
    if (k2 === "inst" || k2 === "schema" || k2 === "continue" || k2 === "input" || k2 === "__proto__")
      continue;
    full[k2] = iss[k2];
  }
  full.path ?? (full.path = []);
  full.message = message;
  if (ctx?.reportInput) {
    full.input = iss.input;
  }
  return full;
}
function getSizableOrigin(input) {
  if (input instanceof Set)
    return "set";
  if (input instanceof Map)
    return "map";
  if (input instanceof File)
    return "file";
  return "unknown";
}
var highSurrogate = /[\uD800-\uDBFF]/;
function codePointLength(str5) {
  const units = str5.length;
  if (!highSurrogate.test(str5))
    return units;
  let count = units;
  for (let i = 0; i < units - 1; i++) {
    if ((str5.charCodeAt(i) & 64512) === 55296 && (str5.charCodeAt(i + 1) & 64512) === 56320) {
      count--;
      i++;
    }
  }
  return count;
}
function getLengthableOrigin(input) {
  if (Array.isArray(input))
    return "array";
  if (typeof input === "string")
    return "string";
  return "unknown";
}
function parsedType(data) {
  const t = typeof data;
  switch (t) {
    case "number": {
      return Number.isNaN(data) ? "nan" : "number";
    }
    case "object": {
      if (data === null) {
        return "null";
      }
      if (Array.isArray(data)) {
        return "array";
      }
      const obj = data;
      if (obj && Object.getPrototypeOf(obj) !== Object.prototype && "constructor" in obj && obj.constructor) {
        return obj.constructor.name;
      }
    }
  }
  return t;
}
function issue(...args) {
  const [iss, input, inst] = args;
  if (typeof iss === "string") {
    return {
      message: iss,
      code: "custom",
      input,
      inst
    };
  }
  return { ...iss };
}
function cleanEnum(obj) {
  return Object.entries(obj).filter(([k2, _2]) => {
    return Number.isNaN(Number.parseInt(k2, 10));
  }).map((el) => el[1]);
}
function base64ToUint8Array(base642) {
  const binaryString = atob(base642);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}
function uint8ArrayToBase64(bytes) {
  let binaryString = "";
  for (let i = 0; i < bytes.length; i++) {
    binaryString += String.fromCharCode(bytes[i]);
  }
  return btoa(binaryString);
}
function base64urlToUint8Array(base64url2) {
  const base642 = base64url2.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - base642.length % 4) % 4);
  return base64ToUint8Array(base642 + padding);
}
function uint8ArrayToBase64url(bytes) {
  return uint8ArrayToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
function hexToUint8Array(hex) {
  const cleanHex = hex.replace(/^0x/, "");
  if (cleanHex.length % 2 !== 0) {
    throw new Error("Invalid hex string length");
  }
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(cleanHex.slice(i, i + 2), 16);
  }
  return bytes;
}
function uint8ArrayToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
var Class = class {
  constructor(..._args) {
  }
};
function members(proto, table) {
  for (const key in table) {
    const desc = Object.getOwnPropertyDescriptor(table, key);
    if (desc.get)
      Object.defineProperty(proto, key, { ...desc, enumerable: false });
    else
      defineBound(proto, key, desc.value);
  }
}
function own(inst, key, value, enumerable = true) {
  Object.defineProperty(inst, key, { configurable: true, writable: true, enumerable, value });
  return value;
}
function hide(inst, key, value) {
  return own(inst, key, value, false);
}
// @__NO_SIDE_EFFECTS__
function derived(computes, table) {
  for (const key in computes) {
    const compute = computes[key];
    Object.defineProperty(table, key, {
      configurable: true,
      enumerable: true,
      get() {
        return own(this, key, compute(this));
      },
      set(value) {
        own(this, key, value);
      }
    });
  }
  return table;
}
function defineBound(proto, key, fn2) {
  Object.defineProperty(proto, key, {
    configurable: true,
    get() {
      return this == null ? fn2 : own(this, key, fn2.bind(this));
    },
    set(value) {
      own(this, key, value);
    }
  });
}
function claim(inst, sentinel) {
  const proto = Object.getPrototypeOf(inst);
  return sentinel in proto ? void 0 : proto;
}
var installing;
var broke = false;
var breaker = {
  configurable: true,
  get() {
    broke = true;
    return void 0;
  }
};
function defineLazyInternal(inst, key, compute) {
  const proto = Object.getPrototypeOf(inst._zod);
  if (key in proto && installing !== inst._zod) {
    installing = void 0;
    return;
  }
  installing = inst._zod;
  Object.defineProperty(proto, key, {
    configurable: true,
    get() {
      Object.defineProperty(this, key, breaker);
      const outer = broke;
      broke = false;
      try {
        const value = compute(this);
        if (broke)
          delete this[key];
        else
          Object.defineProperty(this, key, { configurable: true, writable: true, value });
        broke = broke || outer;
        return value;
      } catch (err) {
        delete this[key];
        broke = broke || outer;
        throw err;
      }
    },
    set(value) {
      Object.defineProperty(this, key, { configurable: true, writable: true, value });
    }
  });
}
function installLazyProp(inst, key, make, enumerable) {
  const proto = claim(inst, key);
  if (!proto)
    return;
  Object.defineProperty(proto, key, {
    configurable: true,
    get() {
      const desc = { configurable: true, writable: true, enumerable, value: void 0 };
      Object.defineProperty(this, key, desc);
      desc.value = make(this);
      Object.defineProperty(this, key, desc);
      return desc.value;
    },
    set(value) {
      Object.defineProperty(this, key, { configurable: true, writable: true, enumerable, value });
    }
  });
}
var CONSTANT_CATCH = "~constantCatch";
function constantCatch(value) {
  const fn2 = () => value;
  fn2[CONSTANT_CATCH] = true;
  return fn2;
}

// node_modules/zod/v4/core/core.js
var _a;
var _zodDesc = { value: void 0, enumerable: false };
var _E = "captureStackTrace" in Error ? Error : null;
function newError(Definition) {
  const E2 = _E;
  if (E2) {
    const saved = E2.stackTraceLimit;
    if (typeof saved === "number") {
      try {
        E2.stackTraceLimit = 0;
      } catch {
        _E = null;
        return new Definition();
      }
      try {
        return new Definition();
      } finally {
        E2.stackTraceLimit = saved;
      }
    }
  }
  return new Definition();
}
// @__NO_SIDE_EFFECTS__
function $constructor(name, initializer3, proto, params) {
  const zodProto = {};
  function Internals(def) {
    this.def = def;
    this.constr = _2;
    this.traits = /* @__PURE__ */ new Set();
  }
  Internals.prototype = zodProto;
  const protoMembers = proto;
  const initialized = protoMembers && /* @__PURE__ */ new WeakSet();
  function init(inst, def) {
    if (!inst._zod) {
      _zodDesc.value = new Internals(def);
      try {
        Object.defineProperty(inst, "_zod", _zodDesc);
      } finally {
        _zodDesc.value = void 0;
      }
    } else if (inst._zod.traits.has(name)) {
      return;
    }
    inst._zod.traits.add(name);
    initializer3(inst, def);
    if (initialized) {
      const own2 = Object.getPrototypeOf(inst);
      const ctorProto = inst._zod.constr.prototype;
      let up = own2;
      while (up && up !== ctorProto)
        up = Object.getPrototypeOf(up);
      const target = up ?? own2;
      if (!initialized.has(target)) {
        initialized.add(target);
        members(target, protoMembers);
      }
    }
    const proto2 = _2.prototype;
    for (const k2 in proto2) {
      if (!Object.prototype.hasOwnProperty.call(proto2, k2))
        continue;
      if (!(k2 in inst)) {
        inst[k2] = proto2[k2].bind(inst);
      }
    }
  }
  const Parent = params?.Parent ?? Object;
  class Definition extends Parent {
  }
  Object.defineProperty(Definition, "name", { value: name });
  function _2(def) {
    const inst = params?.Parent ? newError(Definition) : this;
    init(inst, def);
    const deferred = inst._zod.deferred;
    if (deferred) {
      for (const fn2 of deferred) {
        fn2();
      }
      inst._zod.deferred = void 0;
    }
    const pp = globalThis.__zod_globalConfig?.postProcessor;
    if (pp)
      pp(inst);
    return inst;
  }
  Object.defineProperty(_2, "init", { value: init });
  Object.defineProperty(_2, Symbol.hasInstance, {
    value: (inst) => {
      if (params?.Parent && inst instanceof params.Parent)
        return true;
      return inst?._zod?.traits?.has(name);
    }
  });
  Object.defineProperty(_2, "name", { value: name });
  return _2;
}
var $ZodAsyncError = class extends Error {
  constructor() {
    super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`);
  }
};
var $ZodEncodeError = class extends Error {
  constructor(name) {
    super(`Encountered unidirectional transform during encode: ${name}`);
    this.name = "ZodEncodeError";
  }
};
(_a = globalThis).__zod_globalConfig ?? (_a.__zod_globalConfig = {});
var globalConfig = globalThis.__zod_globalConfig;
function config(newConfig) {
  if (newConfig)
    Object.assign(globalConfig, newConfig);
  return globalConfig;
}

// node_modules/zod/v4/core/errors.js
function _getMessage() {
  const internals = this._zod;
  internals.message ?? (internals.message = JSON.stringify(internals.def, jsonStringifyReplacer, 2));
  return internals.message;
}
function _setMessage(value) {
  this._zod.message = value;
}
var _messageDesc = {
  get: _getMessage,
  set: _setMessage,
  enumerable: true,
  configurable: true
};
var _issuesDesc = { value: void 0, enumerable: false };
var _installedToString = /* @__PURE__ */ new WeakSet([Object.prototype, Error.prototype]);
var initializer = (inst, def) => {
  inst.name = "$ZodError";
  _issuesDesc.value = def;
  Object.defineProperty(inst, "issues", _issuesDesc);
  _issuesDesc.value = void 0;
  Object.defineProperty(inst, "message", _messageDesc);
  const proto = Object.getPrototypeOf(inst);
  if (!_installedToString.has(proto)) {
    _installedToString.add(proto);
    Object.defineProperty(proto, "toString", {
      configurable: true,
      enumerable: false,
      get() {
        const value = () => this.message;
        Object.defineProperty(this, "toString", { value, configurable: true, writable: true });
        return value;
      },
      set(value) {
        Object.defineProperty(this, "toString", { value, configurable: true, writable: true });
      }
    });
  }
};
var $ZodError = $constructor("$ZodError", initializer);
var $ZodRealError = $constructor("$ZodError", initializer, void 0, {
  Parent: Error
});
function node(obj, key, make) {
  if (!Object.prototype.hasOwnProperty.call(obj, key)) {
    if (key === "__proto__") {
      Object.defineProperty(obj, key, { value: make(), writable: true, enumerable: true, configurable: true });
    } else {
      obj[key] = make();
    }
  }
  return obj[key];
}
function flattenError(error2, mapper = (issue2) => issue2.message) {
  const fieldErrors = {};
  const formErrors = [];
  for (const sub of error2.issues) {
    if (sub.path.length > 0) {
      node(fieldErrors, sub.path[0], () => []).push(mapper(sub));
    } else {
      formErrors.push(mapper(sub));
    }
  }
  return { formErrors, fieldErrors };
}
function formatError(error2, mapper = (issue2) => issue2.message) {
  const fieldErrors = { _errors: [] };
  const processError = (error3, path11 = []) => {
    for (const issue2 of error3.issues) {
      if (issue2.code === "invalid_union" && issue2.errors.length) {
        issue2.errors.map((issues) => processError({ issues }, [...path11, ...issue2.path]));
      } else if (issue2.code === "invalid_key") {
        processError({ issues: issue2.issues }, [...path11, ...issue2.path]);
      } else if (issue2.code === "invalid_element") {
        processError({ issues: issue2.issues }, [...path11, ...issue2.path]);
      } else {
        const fullpath = [...path11, ...issue2.path];
        if (fullpath.length === 0) {
          fieldErrors._errors.push(mapper(issue2));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < fullpath.length) {
            const el = fullpath[i];
            const terminal = i === fullpath.length - 1;
            if (el === "_errors") {
              if (terminal)
                curr._errors.push(mapper(issue2));
              i++;
              continue;
            }
            if (!Object.prototype.hasOwnProperty.call(curr, el)) {
              Object.defineProperty(curr, el, {
                value: { _errors: [] },
                enumerable: true,
                writable: true,
                configurable: true
              });
            }
            const node2 = curr[el];
            if (terminal) {
              node2._errors.push(mapper(issue2));
            }
            curr = node2;
            i++;
          }
        }
      }
    }
  };
  processError(error2);
  return fieldErrors;
}

// node_modules/zod/v4/core/parse.js
function finalizeParams(callee, params) {
  return { callee: params?.callee ?? callee, Err: params?.Err };
}
var _parse = (_Err) => {
  const fn2 = (schema, value, _ctx, _params) => {
    const ctx = _ctx ? { ..._ctx, async: false } : { async: false };
    const result = schema._zod.run({ value, issues: [] }, ctx);
    if (result instanceof Promise) {
      throw new $ZodAsyncError();
    }
    if (result.issues.length) {
      const e = new (_params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
      captureStackTrace(e, _params?.callee ?? fn2);
      throw e;
    }
    return result.value;
  };
  return fn2;
};
var _parseAsync = (_Err) => {
  const fn2 = async (schema, value, _ctx, params) => {
    const ctx = _ctx ? { ..._ctx, async: true } : { async: true };
    let result = schema._zod.run({ value, issues: [] }, ctx);
    if (result instanceof Promise)
      result = await result;
    if (result.issues.length) {
      const e = new (params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
      captureStackTrace(e, params?.callee ?? fn2);
      throw e;
    }
    return result.value;
  };
  return fn2;
};
var _safeParse = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: false } : { async: false };
  const result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise) {
    throw new $ZodAsyncError();
  }
  return result.issues.length ? failure(_Err, result.issues, ctx) : { success: true, data: result.value };
};
function failure(Err, issues, ctx) {
  let error2;
  return {
    success: false,
    get error() {
      if (!error2) {
        error2 = new Err(issues.map((iss) => finalizeIssue(iss, ctx, config())));
        issues = void 0;
        ctx = void 0;
      }
      return error2;
    },
    set error(e) {
      error2 = e;
      issues = void 0;
      ctx = void 0;
    }
  };
}
var _safeParseAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: true } : { async: true };
  let result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise)
    result = await result;
  return result.issues.length ? failure(_Err, result.issues, ctx) : { success: true, data: result.value };
};
var COMPILE_INVALID = /* @__PURE__ */ Symbol.for("zod.compile.invalid");
var COMPILE_FALLBACK = /* @__PURE__ */ Symbol.for("zod.compile.fallback");
var validate = ((schema, value, _ctx) => {
  const validator = schema._zod.bag.validator;
  if (validator !== void 0) {
    if (validator(value) !== COMPILE_INVALID)
      return true;
    if (validator.definite === true && _ctx === void 0)
      return false;
  }
  return validateFallback(schema, value, _ctx);
});
function validateFallback(schema, value, _ctx) {
  const ctx = _ctx ? { ..._ctx, async: false, abortEarly: true } : { async: false, abortEarly: true };
  const fallbackRun = schema._zod.bag.fallbackRun;
  let result;
  if (fallbackRun) {
    ctx[COMPILE_FALLBACK] = true;
    result = fallbackRun({ value, issues: [] }, ctx);
  } else {
    result = schema._zod.run({ value, issues: [] }, ctx);
  }
  if (result instanceof Promise) {
    throw new $ZodAsyncError();
  }
  return result.issues.length === 0;
}
var validateAsync = async (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: true, abortEarly: true } : { async: true, abortEarly: true };
  let result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise)
    result = await result;
  return result.issues.length === 0;
};
var _encode = (_Err) => {
  const parse5 = _parse(_Err);
  const fn2 = (schema, value, _ctx, _params) => {
    const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
    return parse5(schema, value, ctx, finalizeParams(fn2, _params));
  };
  return fn2;
};
var _decode = (_Err) => {
  const parse5 = _parse(_Err);
  const fn2 = (schema, value, _ctx, _params) => {
    return parse5(schema, value, _ctx, finalizeParams(fn2, _params));
  };
  return fn2;
};
var _encodeAsync = (_Err) => {
  const parseAsync2 = _parseAsync(_Err);
  const fn2 = async (schema, value, _ctx, _params) => {
    const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
    return await parseAsync2(schema, value, ctx, finalizeParams(fn2, _params));
  };
  return fn2;
};
var _decodeAsync = (_Err) => {
  const parseAsync2 = _parseAsync(_Err);
  const fn2 = async (schema, value, _ctx, _params) => {
    return await parseAsync2(schema, value, _ctx, finalizeParams(fn2, _params));
  };
  return fn2;
};
var _safeEncode = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
  return _safeParse(_Err)(schema, value, ctx);
};
var _safeDecode = (_Err) => (schema, value, _ctx) => {
  return _safeParse(_Err)(schema, value, _ctx);
};
var _safeEncodeAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
  return _safeParseAsync(_Err)(schema, value, ctx);
};
var _safeDecodeAsync = (_Err) => async (schema, value, _ctx) => {
  return _safeParseAsync(_Err)(schema, value, _ctx);
};

// node_modules/zod/v4/core/regexes.js
var cuid = /^[cC][0-9a-z]{6,}$/;
var cuid2 = /^[0-9a-z]+$/;
var ulid = /^[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}$/;
var xid = /^[0-9a-vA-V]{20}$/;
var ksuid = /^[A-Za-z0-9]{27}$/;
var nanoid = /^[a-zA-Z0-9_-]{21}$/;
function nanoidOfLength(length) {
  return new RegExp(`^[a-zA-Z0-9_-]{${length}}$`);
}
var duration = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/;
var guid = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
var uuid = (version2) => {
  if (!version2)
    return /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
  return new RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${version2}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`);
};
var email = /^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
var _emoji = `^(?=[\\s\\S]*[\\p{Extended_Pictographic}\\p{Regional_Indicator}\\u20E3])[\\p{Extended_Pictographic}\\p{Emoji_Component}]+$`;
function emoji() {
  return new RegExp(_emoji, "u");
}
var ipv4 = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;
var cidrv4 = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/;
var cidrv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64 = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/;
var base64url = /^(?:[A-Za-z0-9_-]{4})*(?:[A-Za-z0-9_-]{2,3})?$/;
var httpProtocol = /^https?$/;
var e164 = /^\+[1-9]\d{6,14}$/;
var dateSource = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))`;
function anchor(source) {
  return new RegExp(`^${source}$`);
}
var date = /* @__PURE__ */ anchor(dateSource);
function timeSource(args) {
  const hhmm = `(?:[01]\\d|2[0-3]):[0-5]\\d`;
  const regex = typeof args.precision === "number" ? args.precision === -1 ? `${hhmm}` : args.precision === 0 ? `${hhmm}:[0-5]\\d` : `${hhmm}:[0-5]\\d\\.\\d{${args.precision}}` : args.seconds ? `${hhmm}:[0-5]\\d(?:\\.\\d+)?` : `${hhmm}(?::[0-5]\\d(?:\\.\\d+)?)?`;
  return regex;
}
function time(args) {
  return new RegExp(`^${timeSource(args)}$`);
}
function datetime(args) {
  const opts = ["Z"];
  if (args.offset)
    opts.push(`([+-](?:[01]\\d|2[0-3]):[0-5]\\d)`);
  const qualified = `${timeSource({ precision: args.precision, seconds: true })}(?:${opts.join("|")})`;
  const timeRegex = args.local ? `${qualified}|${timeSource({ precision: args.precision })}` : qualified;
  return new RegExp(`^${dateSource}T(?:${timeRegex})$`);
}
var anyString = /^[\s\S]{0,}$/;
var number = /^-?\d+(?:\.\d+)?$/;
var boolean = /^(?:true|false)$/i;
var lowercase = /^[^A-Z]*$/;
var uppercase = /^[^a-z]*$/;

// node_modules/zod/v4/core/checks.js
var $ZodCheck = /* @__PURE__ */ $constructor("$ZodCheck", (inst, def) => {
  var _a3;
  inst._zod ?? (inst._zod = {});
  inst._zod.def = def;
  (_a3 = inst._zod).onattach ?? (_a3.onattach = []);
});
var _whenHasLength = (payload) => {
  const val = payload.value;
  return !nullish(val) && val.length !== void 0;
};
var numericOriginMap = {
  number: "number",
  bigint: "bigint",
  object: "date"
};
var $ZodCheckLessThan = /* @__PURE__ */ $constructor("$ZodCheckLessThan", (inst, def) => {
  $ZodCheck.init(inst, def);
  const origin = numericOriginMap[typeof def.value];
  inst._zod.check = (payload) => {
    if (def.inclusive ? payload.value <= def.value : payload.value < def.value) {
      return;
    }
    payload.issues.push({
      origin: numericOriginMap[typeof payload.value] ?? origin,
      code: "too_big",
      maximum: typeof def.value === "object" ? def.value.getTime() : def.value,
      input: payload.value,
      inclusive: def.inclusive,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckGreaterThan = /* @__PURE__ */ $constructor("$ZodCheckGreaterThan", (inst, def) => {
  $ZodCheck.init(inst, def);
  const origin = numericOriginMap[typeof def.value];
  inst._zod.check = (payload) => {
    if (def.inclusive ? payload.value >= def.value : payload.value > def.value) {
      return;
    }
    payload.issues.push({
      origin: numericOriginMap[typeof payload.value] ?? origin,
      code: "too_small",
      minimum: typeof def.value === "object" ? def.value.getTime() : def.value,
      input: payload.value,
      inclusive: def.inclusive,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckMultipleOf = /* @__PURE__ */ $constructor("$ZodCheckMultipleOf", (inst, def) => {
  $ZodCheck.init(inst, def);
  inst._zod.check = (payload) => {
    if (typeof payload.value !== typeof def.value)
      throw new Error("Cannot mix number and bigint in multiple_of check.");
    const isMultiple = typeof payload.value === "bigint" ? (
      // `value % 0n` throws, and nothing is a multiple of zero — the number branch already fails this way via NaN
      def.value !== BigInt(0) && payload.value % def.value === BigInt(0)
    ) : floatSafeRemainder(payload.value, def.value) === 0;
    if (isMultiple)
      return;
    payload.issues.push({
      origin: typeof payload.value,
      code: "not_multiple_of",
      divisor: def.value,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckNumberFormat = /* @__PURE__ */ $constructor("$ZodCheckNumberFormat", (inst, def) => {
  $ZodCheck.init(inst, def);
  def.format = def.format || "float64";
  const isInt = def.format?.includes("int");
  const origin = isInt ? "int" : "number";
  const [minimum, maximum] = NUMBER_FORMAT_RANGES[def.format];
  inst._zod.check = (payload) => {
    const input = payload.value;
    if (isInt) {
      if (!Number.isInteger(input)) {
        payload.issues.push({
          expected: origin,
          format: def.format,
          code: "invalid_type",
          continue: false,
          input,
          inst
        });
        return;
      }
      if (!Number.isSafeInteger(input)) {
        if (input > 0) {
          payload.issues.push({
            input,
            code: "too_big",
            maximum: Number.MAX_SAFE_INTEGER,
            note: "Integers must be within the safe integer range.",
            inst,
            origin,
            inclusive: true,
            continue: !def.abort
          });
        } else {
          payload.issues.push({
            input,
            code: "too_small",
            minimum: Number.MIN_SAFE_INTEGER,
            note: "Integers must be within the safe integer range.",
            inst,
            origin,
            inclusive: true,
            continue: !def.abort
          });
        }
        return;
      }
    }
    if (input < minimum) {
      payload.issues.push({
        origin: "number",
        input,
        code: "too_small",
        minimum,
        inclusive: true,
        inst,
        continue: !def.abort
      });
    }
    if (input > maximum) {
      payload.issues.push({
        origin: "number",
        input,
        code: "too_big",
        maximum,
        inclusive: true,
        inst,
        continue: !def.abort
      });
    }
  };
});
var $ZodCheckMaxLength = /* @__PURE__ */ $constructor("$ZodCheckMaxLength", (inst, def) => {
  var _a3;
  $ZodCheck.init(inst, def);
  (_a3 = inst._zod.def).when ?? (_a3.when = _whenHasLength);
  inst._zod.check = (payload) => {
    const input = payload.value;
    const units = input.length;
    const length = typeof input === "string" && units > def.maximum ? codePointLength(input) : units;
    if (length <= def.maximum)
      return;
    const origin = getLengthableOrigin(input);
    payload.issues.push({
      origin,
      code: "too_big",
      maximum: def.maximum,
      inclusive: true,
      input,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckMinLength = /* @__PURE__ */ $constructor("$ZodCheckMinLength", (inst, def) => {
  var _a3;
  $ZodCheck.init(inst, def);
  (_a3 = inst._zod.def).when ?? (_a3.when = _whenHasLength);
  inst._zod.check = (payload) => {
    const input = payload.value;
    const units = input.length;
    const length = typeof input === "string" && units >= def.minimum && units < def.minimum * 2 ? codePointLength(input) : units;
    if (length >= def.minimum)
      return;
    const origin = getLengthableOrigin(input);
    payload.issues.push({
      origin,
      code: "too_small",
      minimum: def.minimum,
      inclusive: true,
      input,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckLengthEquals = /* @__PURE__ */ $constructor("$ZodCheckLengthEquals", (inst, def) => {
  var _a3;
  $ZodCheck.init(inst, def);
  (_a3 = inst._zod.def).when ?? (_a3.when = _whenHasLength);
  inst._zod.check = (payload) => {
    const input = payload.value;
    const units = input.length;
    const length = typeof input === "string" && units >= def.length && units <= def.length * 2 ? codePointLength(input) : units;
    if (length === def.length)
      return;
    const origin = getLengthableOrigin(input);
    const tooBig = length > def.length;
    payload.issues.push({
      origin,
      ...tooBig ? { code: "too_big", maximum: def.length } : { code: "too_small", minimum: def.length },
      inclusive: true,
      exact: true,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckStringFormat = /* @__PURE__ */ $constructor("$ZodCheckStringFormat", (inst, def) => {
  var _a3, _b;
  $ZodCheck.init(inst, def);
  if (def.pattern)
    (_a3 = inst._zod).check ?? (_a3.check = (payload) => {
      def.pattern.lastIndex = 0;
      if (def.pattern.test(payload.value))
        return;
      payload.issues.push({
        origin: "string",
        code: "invalid_format",
        format: def.format,
        input: payload.value,
        ...def.pattern ? { pattern: def.pattern.toString() } : {},
        inst,
        continue: !def.abort
      });
    });
  else
    (_b = inst._zod).check ?? (_b.check = () => {
    });
});
var $ZodCheckRegex = /* @__PURE__ */ $constructor("$ZodCheckRegex", (inst, def) => {
  $ZodCheckStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    def.pattern.lastIndex = 0;
    if (def.pattern.test(payload.value))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "regex",
      input: payload.value,
      pattern: def.pattern.toString(),
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckLowerCase = /* @__PURE__ */ $constructor("$ZodCheckLowerCase", (inst, def) => {
  def.pattern ?? (def.pattern = lowercase);
  $ZodCheckStringFormat.init(inst, def);
});
var $ZodCheckUpperCase = /* @__PURE__ */ $constructor("$ZodCheckUpperCase", (inst, def) => {
  def.pattern ?? (def.pattern = uppercase);
  $ZodCheckStringFormat.init(inst, def);
});
var $ZodCheckIncludes = /* @__PURE__ */ $constructor("$ZodCheckIncludes", (inst, def) => {
  $ZodCheck.init(inst, def);
  const escapedRegex = escapeRegex(def.includes);
  const pattern = new RegExp(typeof def.position === "number" ? `^.{${def.position},}${escapedRegex}` : escapedRegex);
  def.pattern = pattern;
  inst._zod.check = (payload) => {
    if (payload.value.includes(def.includes, def.position))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "includes",
      includes: def.includes,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckStartsWith = /* @__PURE__ */ $constructor("$ZodCheckStartsWith", (inst, def) => {
  $ZodCheck.init(inst, def);
  const pattern = new RegExp(`^${escapeRegex(def.prefix)}.*`);
  def.pattern ?? (def.pattern = pattern);
  inst._zod.check = (payload) => {
    if (payload.value.startsWith(def.prefix))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "starts_with",
      prefix: def.prefix,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckEndsWith = /* @__PURE__ */ $constructor("$ZodCheckEndsWith", (inst, def) => {
  $ZodCheck.init(inst, def);
  const pattern = new RegExp(`.*${escapeRegex(def.suffix)}$`);
  def.pattern ?? (def.pattern = pattern);
  inst._zod.check = (payload) => {
    if (payload.value.endsWith(def.suffix))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "ends_with",
      suffix: def.suffix,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckOverwrite = /* @__PURE__ */ $constructor("$ZodCheckOverwrite", (inst, def) => {
  $ZodCheck.init(inst, def);
  inst._zod.check = (payload) => {
    payload.value = def.tx(payload.value);
  };
});

// node_modules/zod/v4/core/doc.js
var Doc = class {
  constructor(args = [], closed = {}) {
    this.content = [];
    this.indent = 0;
    this.args = args;
    this.closed = closed;
  }
  // the compiler catches a child's throw and keeps writing into this doc, so the indent has to unwind with it
  indented(fn2) {
    this.indent += 1;
    try {
      fn2(this);
    } finally {
      this.indent -= 1;
    }
  }
  write(arg) {
    if (typeof arg === "function") {
      arg(this, { execution: "sync" });
      arg(this, { execution: "async" });
      return;
    }
    const content = arg;
    const lines2 = content.split("\n").filter((x2) => x2);
    const minIndent = Math.min(...lines2.map((x2) => x2.length - x2.trimStart().length));
    const dedented = lines2.map((x2) => x2.slice(minIndent)).map((x2) => " ".repeat(this.indent * 2) + x2);
    for (const line3 of dedented) {
      this.content.push(line3);
    }
  }
  compile() {
    const F2 = Function;
    const content = this?.content ?? [``];
    const factory = new F2(...Object.keys(this.closed), `return function (${this.args.join(", ")}) {
${content.join("\n")}
};`);
    return factory(...Object.values(this.closed));
  }
};

// node_modules/zod/v4/core/versions.js
var version = {
  major: 4,
  minor: 6,
  patch: 7
};

// node_modules/zod/v4/core/schemas.js
var $ZodType = /* @__PURE__ */ $constructor("$ZodType", (inst, def) => {
  var _a3;
  inst ?? (inst = {});
  inst._zod.def = def;
  inst._zod.bag = inst._zod.bag || {};
  inst._zod.version = version;
  const defChecks = inst._zod.def.checks;
  const checks = inst._zod.traits.has("$ZodCheck") ? [inst, ...defChecks ?? []] : defChecks?.length ? [...defChecks] : [];
  for (const ch of checks) {
    for (const fn2 of ch._zod.onattach) {
      fn2(inst);
    }
  }
  if (checks.length === 0) {
    (_a3 = inst._zod).deferred ?? (_a3.deferred = []);
    inst._zod.deferred?.push(() => {
      inst._zod.run = inst._zod.parse;
    });
  } else {
    const runChecks = (payload, checks2, ctx) => {
      if (payload.memo)
        return payload;
      let isAborted = aborted(payload);
      let asyncResult;
      for (const ch of checks2) {
        if (ch._zod.def.when) {
          if (explicitlyAborted(payload))
            continue;
          const shouldRun = ch._zod.def.when(payload);
          if (!shouldRun)
            continue;
        } else if (isAborted) {
          continue;
        }
        const currLen = payload.issues.length;
        const _2 = ch._zod.check(payload);
        if (_2 instanceof Promise && ctx?.async === false) {
          throw new $ZodAsyncError();
        }
        if (asyncResult || _2 instanceof Promise) {
          asyncResult = (asyncResult ?? Promise.resolve()).then(async () => {
            await _2;
            const nextLen = payload.issues.length;
            if (nextLen === currLen)
              return;
            attachSchema(payload.issues, currLen, inst);
            if (!isAborted)
              isAborted = aborted(payload, currLen);
          });
        } else {
          const nextLen = payload.issues.length;
          if (nextLen === currLen)
            continue;
          attachSchema(payload.issues, currLen, inst);
          if (!isAborted)
            isAborted = aborted(payload, currLen);
        }
      }
      if (asyncResult) {
        return asyncResult.then(() => {
          return payload;
        });
      }
      return payload;
    };
    const handleCanaryResult = (canary, payload, ctx) => {
      if (aborted(canary)) {
        canary.aborted = true;
        return canary;
      }
      const checkResult = runChecks(payload, checks, ctx);
      if (checkResult instanceof Promise) {
        if (ctx.async === false)
          throw new $ZodAsyncError();
        return checkResult.then((checkResult2) => inst._zod.parse(checkResult2, ctx));
      }
      return inst._zod.parse(checkResult, ctx);
    };
    inst._zod.run = (payload, ctx) => {
      if (ctx.skipChecks) {
        return inst._zod.parse(payload, ctx);
      }
      if (ctx.direction === "backward") {
        const canary = inst._zod.parse({ value: payload.value, issues: [] }, { ...ctx, skipChecks: true });
        if (canary instanceof Promise) {
          return canary.then((canary2) => {
            return handleCanaryResult(canary2, payload, ctx);
          });
        }
        return handleCanaryResult(canary, payload, ctx);
      }
      const result = inst._zod.parse(payload, ctx);
      if (result instanceof Promise) {
        if (ctx.async === false)
          throw new $ZodAsyncError();
        return result.then((result2) => runChecks(result2, checks, ctx));
      }
      return runChecks(result, checks, ctx);
    };
  }
}, {
  // Wrappers extend this by installing a richer factory over it; reading it eagerly would defeat the laziness.
  get "~standard"() {
    return hide(this, "~standard", standardProps(this));
  },
  set "~standard"(value) {
    own(this, "~standard", value);
  }
});
var toStandardResult = (r2, ctx) => r2.issues.length ? { issues: r2.issues.map((iss) => finalizeIssue(iss, ctx, config())) } : { value: r2.value };
async function validateAsync2(inst, value) {
  const ctx = { async: true };
  return toStandardResult(await inst._zod.run({ value, issues: [] }, ctx), ctx);
}
function standardProps(inst) {
  return {
    validate: (value) => {
      const ctx = { async: false };
      try {
        const r2 = inst._zod.run({ value, issues: [] }, ctx);
        if (!(r2 instanceof Promise))
          return toStandardResult(r2, ctx);
      } catch (_2) {
      }
      return validateAsync2(inst, value);
    },
    vendor: "zod",
    version: 1
  };
}
var $ZodString = /* @__PURE__ */ $constructor("$ZodString", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = def.pattern ?? anyString;
  inst._zod.parse = (payload, _2) => {
    if (def.coerce)
      try {
        payload.value = String(payload.value);
      } catch (_3) {
      }
    if (typeof payload.value === "string")
      return payload;
    payload.issues.push({
      expected: "string",
      code: "invalid_type",
      input: payload.value,
      inst
    });
    return payload;
  };
});
var $ZodStringFormat = /* @__PURE__ */ $constructor("$ZodStringFormat", (inst, def) => {
  $ZodCheckStringFormat.init(inst, def);
  $ZodString.init(inst, def);
});
var $ZodGUID = /* @__PURE__ */ $constructor("$ZodGUID", (inst, def) => {
  def.pattern ?? (def.pattern = guid);
  $ZodStringFormat.init(inst, def);
});
var $ZodUUID = /* @__PURE__ */ $constructor("$ZodUUID", (inst, def) => {
  if (def.version) {
    const versionMap = {
      v1: 1,
      v2: 2,
      v3: 3,
      v4: 4,
      v5: 5,
      v6: 6,
      v7: 7,
      v8: 8
    };
    const v = versionMap[def.version];
    if (v === void 0)
      throw new Error(`Invalid UUID version: "${def.version}"`);
    def.pattern ?? (def.pattern = uuid(v));
  } else
    def.pattern ?? (def.pattern = uuid());
  $ZodStringFormat.init(inst, def);
});
var $ZodEmail = /* @__PURE__ */ $constructor("$ZodEmail", (inst, def) => {
  def.pattern ?? (def.pattern = email);
  $ZodStringFormat.init(inst, def);
});
var URL_BAD_FORMAT = 1;
var URL_UNPARSEABLE = 2;
function canParseURL(input) {
  try {
    if (typeof URL !== "undefined" && typeof URL.canParse === "function")
      return URL.canParse(input);
    new URL(input);
    return true;
  } catch {
    return false;
  }
}
function validateURL(trimmed, def) {
  if (!("normalize" in def) && !("hostname" in def) && !("protocol" in def)) {
    return canParseURL(trimmed) || URL_UNPARSEABLE;
  }
  return parseURLObject(trimmed, def);
}
function parseURLObject(trimmed, def) {
  if (!def.normalize && def.protocol?.source === httpProtocol.source && !/^https?:\/\//i.test(trimmed)) {
    return URL_BAD_FORMAT;
  }
  try {
    if (typeof URL !== "undefined") {
      const URLStatic = URL;
      if (typeof URLStatic.parse === "function")
        return URLStatic.parse(trimmed) ?? URL_UNPARSEABLE;
    }
    return new URL(trimmed);
  } catch {
    return URL_UNPARSEABLE;
  }
}
var asciiTabOrNewline = /[\t\n\r]/g;
function stripTabAndNewline(value) {
  return value.replace(asciiTabOrNewline, "");
}
function urlHostnameOk(url, hostname) {
  hostname.lastIndex = 0;
  return hostname.test(url.hostname);
}
function urlProtocolOk(url, protocol) {
  protocol.lastIndex = 0;
  return protocol.test(url.protocol.endsWith(":") ? url.protocol.slice(0, -1) : url.protocol);
}
var $ZodURL = /* @__PURE__ */ $constructor("$ZodURL", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    try {
      const trimmed = payload.value.trim();
      const url = validateURL(trimmed, def);
      if (url === URL_BAD_FORMAT) {
        payload.issues.push({
          code: "invalid_format",
          format: "url",
          note: "Invalid URL format",
          input: payload.value,
          inst,
          continue: !def.abort
        });
        return;
      }
      if (url === URL_UNPARSEABLE) {
        payload.issues.push({
          code: "invalid_format",
          format: "url",
          input: payload.value,
          inst,
          continue: !def.abort
        });
        return;
      }
      if (url === true) {
        payload.value = stripTabAndNewline(trimmed);
        return;
      }
      if (def.hostname && !urlHostnameOk(url, def.hostname)) {
        payload.issues.push({
          code: "invalid_format",
          format: "url",
          note: "Invalid hostname",
          pattern: def.hostname.source,
          input: payload.value,
          inst,
          continue: !def.abort
        });
      }
      if (def.protocol && !urlProtocolOk(url, def.protocol)) {
        payload.issues.push({
          code: "invalid_format",
          format: "url",
          note: "Invalid protocol",
          pattern: def.protocol.source,
          input: payload.value,
          inst,
          continue: !def.abort
        });
      }
      payload.value = def.normalize ? url.href : stripTabAndNewline(trimmed);
      return;
    } catch (_2) {
      payload.issues.push({
        code: "invalid_format",
        format: "url",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
var $ZodEmoji = /* @__PURE__ */ $constructor("$ZodEmoji", (inst, def) => {
  def.pattern ?? (def.pattern = emoji());
  $ZodStringFormat.init(inst, def);
});
var $ZodNanoID = /* @__PURE__ */ $constructor("$ZodNanoID", (inst, def) => {
  if (def.length !== void 0 && (!Number.isInteger(def.length) || def.length < 1))
    throw new Error(`Invalid nanoid length: ${def.length}`);
  def.pattern ?? (def.pattern = def.length === void 0 ? nanoid : nanoidOfLength(def.length));
  $ZodStringFormat.init(inst, def);
});
var $ZodCUID = /* @__PURE__ */ $constructor("$ZodCUID", (inst, def) => {
  def.pattern ?? (def.pattern = cuid);
  $ZodStringFormat.init(inst, def);
});
var $ZodCUID2 = /* @__PURE__ */ $constructor("$ZodCUID2", (inst, def) => {
  def.pattern ?? (def.pattern = cuid2);
  $ZodStringFormat.init(inst, def);
});
var $ZodULID = /* @__PURE__ */ $constructor("$ZodULID", (inst, def) => {
  def.pattern ?? (def.pattern = ulid);
  $ZodStringFormat.init(inst, def);
});
var $ZodXID = /* @__PURE__ */ $constructor("$ZodXID", (inst, def) => {
  def.pattern ?? (def.pattern = xid);
  $ZodStringFormat.init(inst, def);
});
var $ZodKSUID = /* @__PURE__ */ $constructor("$ZodKSUID", (inst, def) => {
  def.pattern ?? (def.pattern = ksuid);
  $ZodStringFormat.init(inst, def);
});
var $ZodISODateTime = /* @__PURE__ */ $constructor("$ZodISODateTime", (inst, def) => {
  def.pattern ?? (def.pattern = datetime(def));
  $ZodStringFormat.init(inst, def);
});
var $ZodISODate = /* @__PURE__ */ $constructor("$ZodISODate", (inst, def) => {
  def.pattern ?? (def.pattern = date);
  $ZodStringFormat.init(inst, def);
});
var $ZodISOTime = /* @__PURE__ */ $constructor("$ZodISOTime", (inst, def) => {
  def.pattern ?? (def.pattern = time(def));
  $ZodStringFormat.init(inst, def);
});
var $ZodISODuration = /* @__PURE__ */ $constructor("$ZodISODuration", (inst, def) => {
  def.pattern ?? (def.pattern = duration);
  $ZodStringFormat.init(inst, def);
});
var $ZodIPv4 = /* @__PURE__ */ $constructor("$ZodIPv4", (inst, def) => {
  def.pattern ?? (def.pattern = ipv4);
  $ZodStringFormat.init(inst, def);
});
var ipv6Alphabet = /^[0-9a-fA-F:.]+$/;
function isValidIPv6(value) {
  if (!ipv6Alphabet.test(value))
    return false;
  return canParseURL(`http://[${value}]`);
}
var $ZodIPv6 = /* @__PURE__ */ $constructor("$ZodIPv6", (inst, def) => {
  def.pattern ?? (def.pattern = ipv6);
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (!isValidIPv6(payload.value)) {
      payload.issues.push({
        code: "invalid_format",
        format: "ipv6",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
var $ZodCIDRv4 = /* @__PURE__ */ $constructor("$ZodCIDRv4", (inst, def) => {
  def.pattern ?? (def.pattern = cidrv4);
  $ZodStringFormat.init(inst, def);
});
function isValidCIDRv6(value) {
  const parts = value.split("/");
  if (parts.length !== 2)
    return false;
  const [address, prefix] = parts;
  if (!prefix)
    return false;
  const prefixNum = Number(prefix);
  if (`${prefixNum}` !== prefix)
    return false;
  if (prefixNum < 0 || prefixNum > 128)
    return false;
  return isValidIPv6(address);
}
var $ZodCIDRv6 = /* @__PURE__ */ $constructor("$ZodCIDRv6", (inst, def) => {
  def.pattern ?? (def.pattern = cidrv6);
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (!isValidCIDRv6(payload.value)) {
      payload.issues.push({
        code: "invalid_format",
        format: "cidrv6",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
function isValidBase64(data) {
  if (data === "")
    return true;
  if (/\s/.test(data))
    return false;
  if (data.length % 4 !== 0)
    return false;
  try {
    atob(data);
    return true;
  } catch {
    return false;
  }
}
var base64Charset = /^[0-9a-zA-Z+/]*={0,2}$/;
var $ZodBase64 = /* @__PURE__ */ $constructor("$ZodBase64", (inst, def) => {
  def.pattern ?? (def.pattern = base64Charset);
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (isValidBase64(payload.value))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "base64",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var base64urlCharset = /^[A-Za-z0-9_-]*$/;
function isValidBase64URL(data) {
  if (!base64urlCharset.test(data))
    return false;
  const base642 = data.replace(/[-_]/g, (c) => c === "-" ? "+" : "/");
  const padded = base642.padEnd(Math.ceil(base642.length / 4) * 4, "=");
  return isValidBase64(padded);
}
var $ZodBase64URL = /* @__PURE__ */ $constructor("$ZodBase64URL", (inst, def) => {
  def.pattern ?? (def.pattern = base64urlCharset);
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (isValidBase64URL(payload.value))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "base64url",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodE164 = /* @__PURE__ */ $constructor("$ZodE164", (inst, def) => {
  def.pattern ?? (def.pattern = e164);
  $ZodStringFormat.init(inst, def);
});
function isValidJWT(token, algorithm = null) {
  try {
    const tokensParts = token.split(".");
    if (tokensParts.length !== 3)
      return false;
    const [header] = tokensParts;
    if (!header)
      return false;
    const parsedHeader = JSON.parse(atob(header));
    if ("typ" in parsedHeader && parsedHeader?.typ !== "JWT")
      return false;
    if (!parsedHeader.alg)
      return false;
    if (algorithm && (!("alg" in parsedHeader) || parsedHeader.alg !== algorithm))
      return false;
    return true;
  } catch {
    return false;
  }
}
var $ZodJWT = /* @__PURE__ */ $constructor("$ZodJWT", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (isValidJWT(payload.value, def.alg))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "jwt",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodNumber = /* @__PURE__ */ $constructor("$ZodNumber", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = number;
  inst._zod.parse = (payload, _ctx) => {
    if (def.coerce)
      try {
        payload.value = Number(payload.value);
      } catch (_2) {
      }
    const input = payload.value;
    if (typeof input === "number" && !Number.isNaN(input) && Number.isFinite(input)) {
      return payload;
    }
    const received = typeof input === "number" ? Number.isNaN(input) ? "NaN" : !Number.isFinite(input) ? String(input) : void 0 : void 0;
    payload.issues.push({
      expected: "number",
      code: "invalid_type",
      input,
      inst,
      ...received ? { received } : {}
    });
    return payload;
  };
});
var $ZodNumberFormat = /* @__PURE__ */ $constructor("$ZodNumberFormat", (inst, def) => {
  $ZodCheckNumberFormat.init(inst, def);
  $ZodNumber.init(inst, def);
});
var $ZodBoolean = /* @__PURE__ */ $constructor("$ZodBoolean", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = boolean;
  inst._zod.parse = (payload, _ctx) => {
    if (def.coerce)
      try {
        payload.value = Boolean(payload.value);
      } catch (_2) {
      }
    const input = payload.value;
    if (typeof input === "boolean")
      return payload;
    payload.issues.push({
      expected: "boolean",
      code: "invalid_type",
      input,
      inst
    });
    return payload;
  };
});
var $ZodUnknown = /* @__PURE__ */ $constructor("$ZodUnknown", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload) => payload;
});
var $ZodNever = /* @__PURE__ */ $constructor("$ZodNever", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _ctx) => {
    payload.issues.push({
      expected: "never",
      code: "invalid_type",
      input: payload.value,
      inst
    });
    return payload;
  };
});
function capSize(inst, size) {
  const caps = sizeCaps(inst._zod.def.checks);
  if (!caps.length)
    return;
  const cap = Math.min(...caps.map((c) => c[0]));
  const parse5 = inst._zod.parse;
  inst._zod.parse = (payload, ctx) => {
    const n = size(payload.value);
    if (n > cap && !ctx?.skipChecks && ctx?.direction !== "backward") {
      for (const [max, ch] of sizeCaps(inst._zod.def.checks)) {
        if (n > max && ch._zod.def.when(payload)) {
          const start = payload.issues.length;
          ch._zod.check(payload);
          payload.issues[start].continue = false;
          attachSchema(payload.issues, start, inst);
          return payload;
        }
      }
    }
    return parse5(payload, ctx);
  };
}
var arraySize = (input) => Array.isArray(input) ? input.length : -1;
function handleArrayResult(result, final, index) {
  if (result.issues.length) {
    final.issues.push(...prefixIssues(index, result.issues));
  }
  final.value[index] = result.value;
}
var $ZodArray = /* @__PURE__ */ $constructor("$ZodArray", (inst, def) => {
  $ZodType.init(inst, def);
  const memo2 = globalConfig.memoizer;
  memo2?.attach(inst);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!Array.isArray(input)) {
      payload.issues.push({
        expected: "array",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    payload.value = memo2 ? memo2.alloc(inst, payload, Array(input.length), ctx) : Array(input.length);
    const proms = [];
    const abortEarly = ctx?.abortEarly;
    for (let i = 0; i < input.length; i++) {
      const item = input[i];
      const result = def.element._zod.run({
        value: item,
        issues: []
      }, ctx);
      if (result instanceof Promise) {
        proms.push(result.then((result2) => handleArrayResult(result2, payload, i)));
      } else {
        handleArrayResult(result, payload, i);
        if (abortEarly && result.issues.length !== 0 && aborted(result))
          break;
      }
    }
    if (proms.length) {
      return Promise.all(proms).then(() => payload);
    }
    return payload;
  };
  capSize(inst, arraySize);
});
function handlePropertyResult(result, final, key, input, optin, optout) {
  const isPresent = key in input;
  const isOptionalOut = optout === "optional";
  if (!isPresent && isOptionalOut && optin === "optional") {
    return;
  }
  if (result.issues.length) {
    if (optin !== void 0 && isOptionalOut && !isPresent) {
      return;
    }
    final.issues.push(...prefixIssues(key, result.issues));
  }
  if (!isPresent && optin === void 0) {
    if (!result.issues.length) {
      final.issues.push({
        code: "invalid_type",
        expected: "nonoptional",
        input: void 0,
        path: [key]
      });
    }
    return;
  }
  if (result.value === void 0) {
    if (isPresent || optin === "defaulted" && !isOptionalOut) {
      final.value[key] = void 0;
    }
  } else {
    final.value[key] = result.value;
  }
}
var NO_SYMBOL_KEYS = [];
function normalizeDef(def) {
  const keys = Object.keys(def.shape);
  const ownSymbols = Object.getOwnPropertySymbols(def.shape);
  const symbolKeys = ownSymbols.length ? ownSymbols : NO_SYMBOL_KEYS;
  const allKeys = symbolKeys.length ? [...keys, ...symbolKeys] : keys;
  for (const k2 of allKeys) {
    if (!def.shape?.[k2]?._zod?.traits?.has("$ZodType")) {
      throw new Error(`Invalid element at key "${String(k2)}": expected a Zod schema`);
    }
  }
  const okeys = optionalKeys(def.shape);
  return {
    ...def,
    allKeys,
    symbolKeys,
    // string-only: handleCatchall matches it against `for...in`, which never yields a symbol
    keySet: new Set(keys),
    numKeys: keys.length,
    optionalKeys: new Set(okeys)
  };
}
function handleCatchall(proms, input, payload, ctx, def, inst, abortEarly) {
  const unrecognized = [];
  const keySet = def.keySet;
  const _catchall = def.catchall._zod;
  const t = _catchall.def.type;
  const optin = _catchall.optin;
  const optout = _catchall.optout;
  let seen = 0;
  for (const key in input) {
    if (abortEarly && payload.issues.length !== seen) {
      if (aborted(payload, seen))
        break;
      seen = payload.issues.length;
    }
    if (keySet.has(key))
      continue;
    if (key === "__proto__") {
      if (t === "never")
        unrecognized.push(key);
      continue;
    }
    if (t === "never") {
      unrecognized.push(key);
      continue;
    }
    const r2 = _catchall.run({ value: input[key], issues: [] }, ctx);
    if (r2 instanceof Promise) {
      proms.push(r2.then((r3) => handlePropertyResult(r3, payload, key, input, optin, optout)));
    } else {
      handlePropertyResult(r2, payload, key, input, optin, optout);
    }
  }
  if (unrecognized.length) {
    payload.issues.push({
      code: "unrecognized_keys",
      keys: unrecognized,
      input,
      inst,
      // Describes the shape of the input, not the validity of the parsed value, so it never aborts. The parse still fails; the schema's own checks just get to run first, and an enclosing intersection can reconcile the key against a sibling operand.
      continue: true
    });
  }
  if (!proms.length)
    return payload;
  return Promise.all(proms).then(() => {
    return payload;
  });
}
var $ZodObject = /* @__PURE__ */ $constructor("$ZodObject", (inst, def) => {
  $ZodType.init(inst, def);
  const desc = Object.getOwnPropertyDescriptor(def, "shape");
  const sh = desc?.get ? desc.get.raw : def.shape ?? {};
  if (sh) {
    const get = () => {
      const newSh = { ...sh };
      Object.defineProperty(def, "shape", { value: newSh });
      get.raw = newSh;
      return newSh;
    };
    get.raw = sh;
    Object.defineProperty(def, "shape", { get });
  }
  const _normalized = cached(() => normalizeDef(def));
  defineLazyInternal(inst, "propValues", (zod) => {
    const shape = zod.def.shape;
    const propValues = {};
    for (const key in shape) {
      const field2 = shape[key]._zod;
      if (field2.values) {
        if (!Object.prototype.hasOwnProperty.call(propValues, key)) {
          assignProp(propValues, key, /* @__PURE__ */ new Set());
        }
        for (const v of field2.values)
          propValues[key].add(v);
        if (field2.optin !== void 0)
          propValues[key].add(void 0);
      }
    }
    return propValues;
  });
  const isObject2 = isObject;
  const catchall = def.catchall;
  let value;
  const memo2 = globalConfig.memoizer;
  memo2?.attach(inst);
  inst._zod.parse = (payload, ctx) => {
    value ?? (value = _normalized.value);
    const input = payload.value;
    if (!isObject2(input)) {
      payload.issues.push({
        expected: "object",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    payload.value = memo2 ? memo2.alloc(inst, payload, {}, ctx) : {};
    const proms = [];
    const shape = value.shape;
    const abortEarly = ctx?.abortEarly;
    let seen = payload.issues.length;
    for (const key of value.allKeys) {
      if (abortEarly && payload.issues.length !== seen) {
        if (aborted(payload, seen))
          break;
        seen = payload.issues.length;
      }
      if (key === "__proto__")
        continue;
      const el = shape[key];
      const optin = el._zod.optin;
      const optout = el._zod.optout;
      const r2 = el._zod.run({ value: input[key], issues: [] }, ctx);
      if (r2 instanceof Promise) {
        proms.push(r2.then((r3) => handlePropertyResult(r3, payload, key, input, optin, optout)));
      } else {
        handlePropertyResult(r2, payload, key, input, optin, optout);
      }
    }
    if (!catchall) {
      return proms.length ? Promise.all(proms).then(() => payload) : payload;
    }
    return handleCatchall(proms, input, payload, ctx, _normalized.value, inst, abortEarly === true);
  };
});
var $ZodObjectJIT = /* @__PURE__ */ $constructor("$ZodObjectJIT", (inst, def) => {
  $ZodObject.init(inst, def);
  const superParse = inst._zod.parse;
  const _normalized = cached(() => normalizeDef(def));
  const memo2 = globalConfig.memoizer;
  const generateFastpass = (shape) => {
    const normalized = _normalized.value;
    const syms = normalized.symbolKeys;
    const doc = new Doc(["payload", "ctx"], { shape, inst, memo: memo2, syms });
    const parseStr = (k2) => `shape[${k2}]._zod.run({ value: input[${k2}], issues: [] }, ctx)`;
    const prefixStr = (id, k2) => `
          let ${id}_ab = false;
          for (let i = 0; i < ${id}.issues.length; i++) {
            const iss = ${id}.issues[i];
            iss.path = iss.path ? [${k2}, ...iss.path] : [${k2}];
            payload.issues.push(iss);
            if (iss.continue !== true) ${id}_ab = true;
          }
          if (${id}_ab && ctx && ctx.abortEarly) {
            payload.value = newResult;
            return payload;
          }`;
    doc.write(`const input = payload.value;`);
    const ids = /* @__PURE__ */ Object.create(null);
    let counter = 0;
    for (const key of normalized.allKeys) {
      ids[key] = `key_${counter++}`;
    }
    doc.write(memo2 ? `const newResult = memo.alloc(inst, payload, {}, ctx);` : `const newResult = {};`);
    for (const key of normalized.allKeys) {
      if (key === "__proto__")
        continue;
      const id = ids[key];
      const k2 = typeof key === "symbol" ? `syms[${syms.indexOf(key)}]` : esc(key);
      const isPresent = `${k2} in input`;
      const schema = shape[key];
      const optin = schema?._zod?.optin;
      const isOptionalIn = optin !== void 0;
      const isOptionalOut = schema?._zod?.optout === "optional";
      doc.write(`const ${id} = ${parseStr(k2)};`);
      if (isOptionalIn && isOptionalOut) {
        const assign = optin === "optional" ? `${id}_present` : `${id}.value !== undefined || ${id}_present`;
        doc.write(`
        const ${id}_present = ${isPresent};
        if (!${id}.issues.length || ${id}_present) {
          if (${id}.issues.length) {${prefixStr(id, k2)}
          }

          if (${assign}) {
            newResult[${k2}] = ${id}.value;
          }
        }

      `);
      } else if (!isOptionalIn) {
        doc.write(`
        const ${id}_present = ${isPresent};
        if (${id}.issues.length) {${prefixStr(id, k2)}
        }
        if (!${id}_present && !${id}.issues.length) {
          payload.issues.push({
            code: "invalid_type",
            expected: "nonoptional",
            input: undefined,
            path: [${k2}]
          });
          if (ctx && ctx.abortEarly) {
            payload.value = newResult;
            return payload;
          }
        }

        if (${id}_present) {
          newResult[${k2}] = ${id}.value;
        }

      `);
      } else {
        doc.write(`
        if (${id}.issues.length) {${prefixStr(id, k2)}
        }
      `);
        if (optin === "defaulted") {
          doc.write(`newResult[${k2}] = ${id}.value;`);
        } else {
          doc.write(`
        if (${id}.value !== undefined || ${isPresent}) {
          newResult[${k2}] = ${id}.value;
        }
      `);
        }
      }
    }
    doc.write(`payload.value = newResult;`);
    doc.write(`return payload;`);
    return doc.compile();
  };
  let fastpass;
  const isObject2 = isObject;
  const jit = !globalConfig.jitless;
  const allowsEval2 = allowsEval;
  const fastEnabled = jit && allowsEval2.value;
  const catchall = def.catchall;
  let value;
  inst._zod.parse = (payload, ctx) => {
    value ?? (value = _normalized.value);
    const input = payload.value;
    if (!isObject2(input)) {
      payload.issues.push({
        expected: "object",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    if (jit && fastEnabled && ctx?.async === false && ctx.jitless !== true) {
      if (!fastpass)
        fastpass = generateFastpass(def.shape);
      payload = fastpass(payload, ctx);
      if (!catchall)
        return payload;
      return handleCatchall([], input, payload, ctx, value, inst, ctx?.abortEarly === true);
    }
    return superParse(payload, ctx);
  };
});
function handleUnionResults(results, final, inst, ctx) {
  for (const result of results) {
    if (result.issues.length === 0) {
      final.value = result.value;
      return final;
    }
  }
  const nonaborted = results.filter((r2) => !aborted(r2));
  if (nonaborted.length === 1) {
    final.value = nonaborted[0].value;
    return nonaborted[0];
  }
  final.issues.push({
    code: "invalid_union",
    input: final.value,
    inst,
    errors: results.map((result) => result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
  });
  return final;
}
var $ZodUnion = /* @__PURE__ */ $constructor("$ZodUnion", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "optin", (zod) => zod.def.options.some((o) => o._zod.optin === "defaulted") ? "defaulted" : zod.def.options.some((o) => o._zod.optin !== void 0) ? "optional" : void 0);
  defineLazyInternal(inst, "optout", (zod) => zod.def.options.some((o) => o._zod.optout === "optional") ? "optional" : void 0);
  defineLazyInternal(inst, "values", (zod) => {
    if (zod.def.options.every((o) => o._zod.values)) {
      return new Set(zod.def.options.flatMap((option) => Array.from(option._zod.values)));
    }
    return void 0;
  });
  defineLazyInternal(inst, "pattern", (zod) => {
    if (zod.def.options.every((o) => o._zod.pattern)) {
      const patterns = zod.def.options.map((o) => o._zod.pattern);
      return new RegExp(`^(${patterns.map((p) => cleanRegex(p.source)).join("|")})$`);
    }
    return void 0;
  });
  const first = def.options.length === 1 ? def.options[0]._zod.run : null;
  inst._zod.parse = (payload, ctx) => {
    if (first) {
      return first(payload, ctx);
    }
    let async = false;
    const results = [];
    for (const option of def.options) {
      const result = option._zod.run({
        value: payload.value,
        issues: []
      }, ctx);
      if (result instanceof Promise) {
        results.push(result);
        async = true;
      } else {
        if (result.issues.length === 0)
          return result;
        results.push(result);
      }
    }
    if (!async)
      return handleUnionResults(results, payload, inst, ctx);
    return Promise.all(results).then((results2) => {
      return handleUnionResults(results2, payload, inst, ctx);
    });
  };
});
var $ZodIntersection = /* @__PURE__ */ $constructor("$ZodIntersection", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    const left = def.left._zod.run({ value: input, issues: [] }, ctx);
    const right = def.right._zod.run({ value: input, issues: [] }, ctx);
    const async = left instanceof Promise || right instanceof Promise;
    if (async) {
      return Promise.all([left, right]).then(([left2, right2]) => {
        return handleIntersectionResults(payload, left2, right2);
      });
    }
    return handleIntersectionResults(payload, left, right);
  };
});
function mergeValues(a, b) {
  if (a === b) {
    return { valid: true, data: a };
  }
  if (a instanceof Date && b instanceof Date && +a === +b) {
    return { valid: true, data: a };
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const bKeys = Object.keys(b);
    const sharedKeys = Object.keys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    if (Object.prototype.hasOwnProperty.call(newObj, "__proto__"))
      delete newObj.__proto__;
    for (const key of sharedKeys) {
      if (key === "__proto__")
        continue;
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return {
          valid: false,
          mergeErrorPath: [key, ...sharedValue.mergeErrorPath]
        };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return { valid: false, mergeErrorPath: [] };
    }
    const newArray = [];
    for (let index = 0; index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return {
          valid: false,
          mergeErrorPath: [index, ...sharedValue.mergeErrorPath]
        };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  }
  return { valid: false, mergeErrorPath: [] };
}
function handleIntersectionResults(result, left, right) {
  const unrecKeys = /* @__PURE__ */ new Map();
  let unrecIssue;
  const keyIssues = /* @__PURE__ */ new Map();
  const collect = (iss, side) => {
    let keys;
    if (iss.code === "unrecognized_keys" && !iss.path?.length) {
      unrecIssue ?? (unrecIssue = iss);
      keys = iss.keys;
    } else if (iss.code === "invalid_key" && iss.origin === "record" && iss.path?.length === 1) {
      const k2 = String(iss.path[0]);
      if (!keyIssues.has(k2))
        keyIssues.set(k2, iss);
      keys = [k2];
    } else {
      return false;
    }
    for (const k2 of keys) {
      if (!unrecKeys.has(k2))
        unrecKeys.set(k2, {});
      unrecKeys.get(k2)[side] = true;
    }
    return true;
  };
  for (const iss of left.issues) {
    if (!collect(iss, "l"))
      result.issues.push(iss);
  }
  for (const iss of right.issues) {
    if (!collect(iss, "r"))
      result.issues.push(iss);
  }
  const bothKeys = [...unrecKeys].filter(([, f]) => f.l && f.r).map(([k2]) => k2);
  if (bothKeys.length) {
    const aggregated = unrecIssue ? bothKeys.filter((k2) => unrecIssue.keys.includes(k2)) : [];
    if (aggregated.length)
      result.issues.push({ ...unrecIssue, keys: aggregated });
    for (const k2 of bothKeys) {
      if (!aggregated.includes(k2) && keyIssues.has(k2))
        result.issues.push(keyIssues.get(k2));
    }
  }
  const merged = mergeValues(left.value, right.value);
  if (!merged.valid) {
    if (aborted(result))
      return result;
    throw new Error(`Unmergable intersection. Error path: ${JSON.stringify(merged.mergeErrorPath)}`);
  }
  result.value = merged.data;
  return result;
}
var $ZodEnum = /* @__PURE__ */ $constructor("$ZodEnum", (inst, def) => {
  $ZodType.init(inst, def);
  const values = getEnumValues(def.entries);
  const valuesSet = new Set(values);
  inst._zod.values = valuesSet;
  defineLazyInternal(inst, "pattern", (zod) => {
    const patternValues = getEnumValues(zod.def.entries).filter((k2) => propertyKeyTypes.has(typeof k2));
    return new RegExp(patternValues.length ? `^(${patternValues.map((o) => escapeRegex(o.toString())).join("|")})$` : "^[^\\s\\S]$");
  });
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (valuesSet.has(input)) {
      return payload;
    }
    payload.issues.push({
      code: "invalid_value",
      values,
      input,
      inst
    });
    return payload;
  };
});
var $ZodTransform = /* @__PURE__ */ $constructor("$ZodTransform", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  globalConfig.memoizer?.guard(inst);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      throw new $ZodEncodeError(inst.constructor.name);
    }
    const _out = def.transform(payload.value, payload);
    if (ctx.async) {
      const output = _out instanceof Promise ? _out : Promise.resolve(_out);
      return output.then((output2) => {
        payload.value = output2;
        return payload;
      });
    }
    if (_out instanceof Promise) {
      throw new $ZodAsyncError();
    }
    payload.value = _out;
    return payload;
  };
});
function handleOptionalResult(payload, result) {
  payload.value = result.issues.length ? void 0 : result.value;
  return payload;
}
var $ZodOptional = /* @__PURE__ */ $constructor("$ZodOptional", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "optin", (zod) => zod.def.innerType._zod.optin === "defaulted" ? "defaulted" : "optional");
  inst._zod.optout = "optional";
  defineLazyInternal(inst, "values", (zod) => {
    const values = zod.def.innerType._zod.values;
    return values ? /* @__PURE__ */ new Set([...values, void 0]) : void 0;
  });
  defineLazyInternal(inst, "pattern", (zod) => {
    const pattern = zod.def.innerType._zod.pattern;
    return pattern ? new RegExp(`^(${cleanRegex(pattern.source)})?$`) : void 0;
  });
  inst._zod.parse = (payload, ctx) => {
    if (payload.value === void 0) {
      if (def.innerType._zod.optin !== "defaulted")
        return payload;
      const result = def.innerType._zod.run({ value: payload.value, issues: [] }, ctx);
      if (result instanceof Promise)
        return result.then((result2) => handleOptionalResult(payload, result2));
      return handleOptionalResult(payload, result);
    }
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodExactOptional = /* @__PURE__ */ $constructor("$ZodExactOptional", (inst, def) => {
  $ZodOptional.init(inst, def);
  defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
  defineLazyInternal(inst, "pattern", (zod) => zod.def.innerType._zod.pattern);
  inst._zod.parse = (payload, ctx) => {
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodNullable = /* @__PURE__ */ $constructor("$ZodNullable", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "optin", (zod) => zod.def.innerType._zod.optin);
  defineLazyInternal(inst, "optout", (zod) => zod.def.innerType._zod.optout);
  defineLazyInternal(inst, "pattern", (zod) => {
    const pattern = zod.def.innerType._zod.pattern;
    return pattern ? new RegExp(`^(${cleanRegex(pattern.source)}|null)$`) : void 0;
  });
  defineLazyInternal(inst, "values", (zod) => {
    return zod.def.innerType._zod.values ? /* @__PURE__ */ new Set([...zod.def.innerType._zod.values, null]) : void 0;
  });
  inst._zod.parse = (payload, ctx) => {
    if (payload.value === null)
      return payload;
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodDefault = /* @__PURE__ */ $constructor("$ZodDefault", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "defaulted";
  defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    if (payload.value === void 0) {
      payload.value = def.defaultValue;
      return payload;
    }
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result2) => handleDefaultResult(result2, def));
    }
    return handleDefaultResult(result, def);
  };
});
function handleDefaultResult(payload, def) {
  if (payload.value === void 0) {
    payload.value = def.defaultValue;
  }
  return payload;
}
var $ZodPrefault = /* @__PURE__ */ $constructor("$ZodPrefault", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "defaulted";
  defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    if (payload.value === void 0) {
      payload.value = def.defaultValue;
    }
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodNonOptional = /* @__PURE__ */ $constructor("$ZodNonOptional", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "values", (zod) => {
    const v = zod.def.innerType._zod.values;
    return v ? new Set([...v].filter((x2) => x2 !== void 0)) : void 0;
  });
  inst._zod.parse = (payload, ctx) => {
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result2) => handleNonOptionalResult(result2, inst));
    }
    return handleNonOptionalResult(result, inst);
  };
});
function handleNonOptionalResult(payload, inst) {
  if (!payload.issues.length && payload.value === void 0) {
    payload.issues.push({
      code: "invalid_type",
      expected: "nonoptional",
      input: payload.value,
      inst
    });
  }
  return payload;
}
function handleCatchResult(payload, result, def, ctx) {
  if (!result.issues.length) {
    payload.value = result.value;
    if (result.memo)
      payload.memo = true;
    return payload;
  }
  payload.value = def.catchValue({
    ...result,
    value: payload.value,
    error: {
      issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config()))
    },
    input: payload.value
  });
  return payload;
}
var $ZodCatch = /* @__PURE__ */ $constructor("$ZodCatch", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "optin", (zod) => zod.def.innerType._zod.optin === "defaulted" ? "defaulted" : "optional");
  defineLazyInternal(inst, "optout", (zod) => zod.def.innerType._zod.optout);
  defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    const result = def.innerType._zod.run({ value: payload.value, issues: [] }, ctx);
    if (result instanceof Promise) {
      return result.then((result2) => handleCatchResult(payload, result2, def, ctx));
    }
    return handleCatchResult(payload, result, def, ctx);
  };
});
var $ZodPipe = /* @__PURE__ */ $constructor("$ZodPipe", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "values", (zod) => zod.def.in._zod.values);
  defineLazyInternal(inst, "optin", (zod) => zod.def.in._zod.optin);
  defineLazyInternal(inst, "optout", (zod) => zod.def.out._zod.optout);
  defineLazyInternal(inst, "propValues", (zod) => zod.def.in._zod.propValues);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      const right = def.out._zod.run(payload, ctx);
      if (right instanceof Promise) {
        return right.then((right2) => handlePipeResult(right2, def.in, ctx));
      }
      return handlePipeResult(right, def.in, ctx);
    }
    const left = def.in._zod.run(payload, ctx);
    if (left instanceof Promise) {
      return left.then((left2) => handlePipeResult(left2, def.out, ctx));
    }
    return handlePipeResult(left, def.out, ctx);
  };
});
function handlePipeResult(left, next, ctx) {
  if (left.issues.some((iss) => iss.code !== "unrecognized_keys")) {
    left.aborted = true;
    return left;
  }
  return next._zod.run({ value: left.value, issues: left.issues }, ctx);
}
var $ZodReadonly = /* @__PURE__ */ $constructor("$ZodReadonly", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "propValues", (zod) => zod.def.innerType._zod.propValues);
  defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
  defineLazyInternal(inst, "optin", (zod) => zod.def.innerType?._zod?.optin);
  defineLazyInternal(inst, "optout", (zod) => zod.def.innerType?._zod?.optout);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then(handleReadonlyResult);
    }
    return handleReadonlyResult(result);
  };
});
function handleReadonlyResult(payload) {
  if (!payload.memo)
    payload.value = Object.freeze(payload.value);
  return payload;
}
var $ZodCustom = /* @__PURE__ */ $constructor("$ZodCustom", (inst, def) => {
  $ZodCheck.init(inst, def);
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _2) => {
    return payload;
  };
  inst._zod.check = (payload) => {
    const input = payload.value;
    const r2 = def.fn(input);
    if (r2 instanceof Promise) {
      return r2.then((r3) => handleRefineResult(r3, payload, input, inst));
    }
    handleRefineResult(r2, payload, input, inst);
    return;
  };
});
function handleRefineResult(result, payload, input, inst) {
  if (!result) {
    const _iss = {
      code: "custom",
      input,
      inst,
      // incorporates params.error into issue reporting
      path: [...inst._zod.def.path ?? []],
      // incorporates params.error into issue reporting
      continue: !inst._zod.def.abort
      // params: inst._zod.def.params,
    };
    if (inst._zod.def.params)
      _iss.params = inst._zod.def.params;
    payload.issues.push(issue(_iss));
  }
}

// node_modules/zod/v4/core/memoizer.js
var $ZodCyclicError = class extends Error {
  constructor() {
    super(`Cannot parse a reference cycle that closes through a transform`);
    this.name = "ZodCyclicError";
  }
};
var STATE = "~memo";
var NO_ISSUES = [];
function isRef(value) {
  return value !== null && typeof value === "object";
}
function cloneIssues(issues) {
  return issues.map((iss) => iss.path ? { ...iss, path: iss.path.slice() } : { ...iss });
}
var recursive = /* @__PURE__ */ new WeakMap();
var NONE = 0;
var ASSUMED = 1;
var PROVEN = 2;
function isRecursive(inst, stack, resolve) {
  const cached2 = recursive.get(inst);
  if (cached2 !== void 0)
    return cached2 ? PROVEN : NONE;
  if (stack.has(inst))
    return PROVEN;
  stack.add(inst);
  let result = NONE;
  const check = (child) => {
    if (result !== PROVEN && child?._zod) {
      const answer = isRecursive(child, stack, resolve);
      if (answer > result)
        result = answer;
    }
  };
  const shape = (sh, spread) => {
    let answer = NONE;
    for (const key of Reflect.ownKeys(sh)) {
      const desc = Object.getOwnPropertyDescriptor(sh, key);
      if (spread && !desc.enumerable)
        continue;
      const child = desc.get ? ASSUMED : desc.value?._zod ? isRecursive(desc.value, stack, resolve) : NONE;
      if (child > answer)
        answer = child;
    }
    return answer;
  };
  const merge2 = (answer) => {
    if (answer > result)
      result = answer;
  };
  const def = inst._zod.def;
  const kind = def.type;
  switch (kind) {
    case "object": {
      const raw = rawShape(def);
      merge2(raw ? shape(raw, true) : ASSUMED);
      check(def.catchall);
      break;
    }
    case "array":
      check(def.element);
      break;
    case "tuple":
      for (const el of def.items)
        check(el);
      check(def.rest);
      break;
    case "record":
    case "map":
      check(def.keyType);
      check(def.valueType);
      break;
    case "set":
      check(def.valueType);
      break;
    case "union":
      for (const el of def.options)
        check(el);
      break;
    case "intersection":
      check(def.left);
      check(def.right);
      break;
    case "optional":
    case "nullable":
    case "default":
    case "prefault":
    case "catch":
    case "readonly":
    case "nonoptional":
    case "promise":
    case "success":
      check(def.innerType);
      break;
    case "pipe":
      check(def.in);
      check(def.out);
      break;
    case "function":
      check(def.input);
      check(def.output);
      break;
    // `$ZodLazy` caches its inner on the def, so a resolved edge is followed exactly
    case "lazy": {
      const inner = def._cachedInner ?? (resolve ? inst._zod.innerType : void 0);
      merge2(inner ? isRecursive(inner, stack, false) : ASSUMED);
      break;
    }
    // a leaf by choice: `parts` are regex fragments, not data positions
    case "template_literal":
    // leaves
    case "string":
    case "number":
    case "int":
    case "boolean":
    case "bigint":
    case "symbol":
    case "undefined":
    case "null":
    case "void":
    case "never":
    case "any":
    case "unknown":
    case "date":
    case "nan":
    case "enum":
    case "literal":
    case "file":
    case "transform":
    case "custom":
      break;
    default: {
      kind;
      for (const key in def) {
        const desc = Object.getOwnPropertyDescriptor(def, key);
        if (!desc || desc.get)
          continue;
        const value = desc.value;
        if (!value || typeof value !== "object")
          continue;
        if (value._zod)
          check(value);
        else if (Array.isArray(value))
          for (const el of value)
            check(el);
      }
    }
  }
  stack.delete(inst);
  return settle(inst, result);
}
function settle(inst, answer) {
  if (answer !== ASSUMED)
    recursive.set(inst, answer === PROVEN);
  return answer;
}
function bucketFor(state, inst) {
  let bucket = state.buckets.get(inst);
  if (!bucket) {
    bucket = /* @__PURE__ */ new WeakMap();
    state.buckets.set(inst, bucket);
  }
  return bucket;
}
var handoff;
var open = [];
var memo = {
  alloc(_inst, payload, empty) {
    const bucket = handoff;
    if (!bucket)
      return empty;
    handoff = void 0;
    const entry = { value: empty, issues: null };
    bucket.set(payload.value, entry);
    open.push(entry);
    return empty;
  },
  guard(inst) {
    var _a3;
    (_a3 = inst._zod).deferred ?? (_a3.deferred = []);
    inst._zod.deferred.push(() => {
      const base = inst._zod.parse;
      const wrapped = (payload, ctx) => {
        if (ctx.direction !== "backward" && isBackEdge(ctx, payload.value))
          throw new $ZodCyclicError();
        return base(payload, ctx);
      };
      inst._zod.parse = wrapped;
      if (inst._zod.run === base)
        inst._zod.run = wrapped;
    });
  },
  attach(inst) {
    var _a3;
    let isRecursiveInst;
    let rechecked = false;
    let lastCtx;
    let lastBucket;
    (_a3 = inst._zod).deferred ?? (_a3.deferred = []);
    inst._zod.deferred.push(() => {
      const base = inst._zod.parse;
      const wrapped = (payload, ctx) => {
        if (isRecursiveInst === void 0) {
          const walked = isRecursive(inst, /* @__PURE__ */ new Set(), false);
          if (walked === NONE) {
            inst._zod.parse = base;
            if (inst._zod.run === wrapped)
              inst._zod.run = base;
            return base(payload, ctx);
          }
          if (walked === PROVEN || rechecked)
            isRecursiveInst = true;
          else
            rechecked = true;
        }
        const input = payload.value;
        if (!isRef(input))
          return base(payload, ctx);
        let state = ctx[STATE];
        if (!state) {
          state = { buckets: /* @__PURE__ */ new WeakMap(), backEdges: void 0 };
          ctx[STATE] = state;
        }
        let bucket;
        if (lastCtx === ctx) {
          bucket = lastBucket;
        } else {
          bucket = bucketFor(state, inst);
          lastCtx = ctx;
          lastBucket = bucket;
        }
        const hit = bucket.get(input);
        if (hit) {
          payload.value = hit.value;
          if (hit.issues) {
            if (hit.issues.length)
              payload.issues.push(...cloneIssues(hit.issues));
          } else {
            payload.memo = true;
            state.backEdges ?? (state.backEdges = /* @__PURE__ */ new WeakSet());
            state.backEdges.add(hit.value);
          }
          return payload;
        }
        handoff = bucket;
        const depth = open.length;
        const result = base(payload, ctx);
        handoff = void 0;
        const entry = open.length > depth ? open.pop() : void 0;
        if (result instanceof Promise) {
          return result.then((r2) => {
            if (entry)
              entry.issues = r2.issues.length ? cloneIssues(r2.issues) : NO_ISSUES;
            return r2;
          });
        }
        if (entry)
          entry.issues = result.issues.length ? cloneIssues(result.issues) : NO_ISSUES;
        return result;
      };
      inst._zod.parse = wrapped;
      if (inst._zod.run === base)
        inst._zod.run = wrapped;
    });
  }
};
function memoizer() {
  return memo;
}
function isBackEdge(ctx, value) {
  const backEdges = ctx[STATE]?.backEdges;
  return backEdges !== void 0 && isRef(value) && backEdges.has(value);
}

// node_modules/zod/v4/locales/en.js
var error = () => {
  const Sizable = {
    string: { unit: "characters", verb: "to have" },
    file: { unit: "bytes", verb: "to have" },
    array: { unit: "items", verb: "to have" },
    set: { unit: "items", verb: "to have" },
    map: { unit: "entries", verb: "to have" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "input",
    email: "email address",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO datetime",
    date: "ISO date",
    time: "ISO time",
    duration: "ISO duration",
    ipv4: "IPv4 address",
    ipv6: "IPv6 address",
    mac: "MAC address",
    cidrv4: "IPv4 range",
    cidrv6: "IPv6 range",
    base64: "base64-encoded string",
    base64url: "base64url-encoded string",
    json_string: "JSON string",
    e164: "E.164 number",
    currency_code: "currency code",
    credit_card: "credit card number",
    iban: "IBAN",
    jwt: "JWT",
    template_literal: "input"
  };
  const TypeDictionary = {
    // Compatibility: "nan" -> "NaN" for display
    nan: "NaN"
    // All other type names omitted - they fall back to raw values via ?? operator
  };
  function getTypeName(type, input) {
    if (type === "number" && typeof input === "number" && !Number.isFinite(input)) {
      return String(input);
    }
    return TypeDictionary[type] ?? type;
  }
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = getTypeName(issue2.expected);
        const receivedType = parsedType(issue2.input);
        const received = getTypeName(receivedType, issue2.input);
        return `Invalid input: expected ${expected}, received ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Invalid input: expected ${stringifyPrimitive(issue2.values[0])}`;
        return `Invalid option: expected one of ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.exact ? "exactly " : issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Too big: expected ${issue2.origin ?? "value"} to have ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "elements"}`;
        return `Too big: expected ${issue2.origin ?? "value"} to be ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.exact ? "exactly " : issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Too small: expected ${issue2.origin} to have ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `Too small: expected ${issue2.origin} to be ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `Invalid string: must start with "${_issue.prefix}"`;
        }
        if (_issue.format === "ends_with")
          return `Invalid string: must end with "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Invalid string: must include "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Invalid string: must match pattern ${_issue.pattern}`;
        return `Invalid ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Invalid number: must be a multiple of ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Unrecognized key${issue2.keys.length > 1 ? "s" : ""}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Invalid key in ${issue2.origin}`;
      case "invalid_union":
        if (issue2.options && Array.isArray(issue2.options) && issue2.options.length > 0) {
          const opts = issue2.options.map((o) => `'${o}'`).join(" | ");
          return `Invalid discriminator value. Expected ${opts}`;
        }
        if (issue2.inclusive === false) {
          return "Invalid input: more than one option matched";
        }
        return "Invalid input";
      case "invalid_element":
        return `Invalid value in ${issue2.origin}`;
      default:
        return `Invalid input`;
    }
  };
};
function en_default() {
  return {
    localeError: error()
  };
}

// node_modules/zod/v4/core/registries.js
var _a2;
var $ZodRegistry = class {
  constructor() {
    this._map = /* @__PURE__ */ new WeakMap();
    this._idmap = /* @__PURE__ */ new Map();
  }
  add(schema, ..._meta) {
    const meta2 = _meta[0];
    this._map.set(schema, meta2);
    if (meta2 && typeof meta2 === "object" && "id" in meta2) {
      this._idmap.set(meta2.id, schema);
    }
    return this;
  }
  clear() {
    this._map = /* @__PURE__ */ new WeakMap();
    this._idmap = /* @__PURE__ */ new Map();
    return this;
  }
  remove(schema) {
    const meta2 = this._map.get(schema);
    if (meta2 && typeof meta2 === "object" && "id" in meta2) {
      this._idmap.delete(meta2.id);
    }
    this._map.delete(schema);
    return this;
  }
  get(schema) {
    const p = schema._zod.parent;
    if (p) {
      const pm = { ...this.get(p) ?? {} };
      delete pm.id;
      const f = { ...pm, ...this._map.get(schema) };
      return Object.keys(f).length ? f : void 0;
    }
    return this._map.get(schema);
  }
  has(schema) {
    return this._map.has(schema);
  }
};
function registry() {
  return new $ZodRegistry();
}
(_a2 = globalThis).__zod_globalRegistry ?? (_a2.__zod_globalRegistry = registry());
var globalRegistry = globalThis.__zod_globalRegistry;

// node_modules/zod/v4/core/api.js
function snapshotChecks(def) {
  if (def.checks)
    def.checks = [...def.checks];
  return def;
}
// @__NO_SIDE_EFFECTS__
function _string(Class2, params) {
  return new Class2(snapshotChecks({ type: "string", ...normalizeParams(params) }));
}
// @__NO_SIDE_EFFECTS__
function _email(Class2, params) {
  return new Class2({
    type: "string",
    format: "email",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _guid(Class2, params) {
  return new Class2({
    type: "string",
    format: "guid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _uuid(Class2, params) {
  return new Class2({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _uuidv4(Class2, params) {
  return new Class2({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v4",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _uuidv6(Class2, params) {
  return new Class2({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v6",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _uuidv7(Class2, params) {
  return new Class2({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v7",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _url(Class2, params) {
  return new Class2({
    type: "string",
    format: "url",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _emoji2(Class2, params) {
  return new Class2({
    type: "string",
    format: "emoji",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _nanoid(Class2, params) {
  return new Class2({
    type: "string",
    format: "nanoid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _cuid(Class2, params) {
  return new Class2({
    type: "string",
    format: "cuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _cuid2(Class2, params) {
  return new Class2({
    type: "string",
    format: "cuid2",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _ulid(Class2, params) {
  return new Class2({
    type: "string",
    format: "ulid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _xid(Class2, params) {
  return new Class2({
    type: "string",
    format: "xid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _ksuid(Class2, params) {
  return new Class2({
    type: "string",
    format: "ksuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _ipv4(Class2, params) {
  return new Class2({
    type: "string",
    format: "ipv4",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _ipv6(Class2, params) {
  return new Class2({
    type: "string",
    format: "ipv6",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _cidrv4(Class2, params) {
  return new Class2({
    type: "string",
    format: "cidrv4",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _cidrv6(Class2, params) {
  return new Class2({
    type: "string",
    format: "cidrv6",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _base64(Class2, params) {
  return new Class2({
    type: "string",
    format: "base64",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _base64url(Class2, params) {
  return new Class2({
    type: "string",
    format: "base64url",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _e164(Class2, params) {
  return new Class2({
    type: "string",
    format: "e164",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _jwt(Class2, params) {
  return new Class2({
    type: "string",
    format: "jwt",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _isoDateTime(Class2, params) {
  return new Class2({
    type: "string",
    format: "datetime",
    check: "string_format",
    offset: false,
    local: false,
    precision: null,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _isoDate(Class2, params) {
  return new Class2({
    type: "string",
    format: "date",
    check: "string_format",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _isoTime(Class2, params) {
  return new Class2({
    type: "string",
    format: "time",
    check: "string_format",
    precision: null,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _isoDuration(Class2, params) {
  return new Class2({
    type: "string",
    format: "duration",
    check: "string_format",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _number(Class2, params) {
  return new Class2(snapshotChecks({ type: "number", checks: [], ...normalizeParams(params) }));
}
// @__NO_SIDE_EFFECTS__
function _int(Class2, params) {
  return new Class2({
    type: "number",
    check: "number_format",
    abort: false,
    format: "safeint",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _boolean(Class2, params) {
  return new Class2({
    type: "boolean",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _unknown(Class2) {
  return new Class2({
    type: "unknown"
  });
}
// @__NO_SIDE_EFFECTS__
function _never(Class2, params) {
  return new Class2({
    type: "never",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _lt(value, params) {
  return new $ZodCheckLessThan({
    check: "less_than",
    ...normalizeParams(params),
    value,
    inclusive: false
  });
}
// @__NO_SIDE_EFFECTS__
function _lte(value, params) {
  return new $ZodCheckLessThan({
    check: "less_than",
    ...normalizeParams(params),
    value,
    inclusive: true
  });
}
// @__NO_SIDE_EFFECTS__
function _gt(value, params) {
  return new $ZodCheckGreaterThan({
    check: "greater_than",
    ...normalizeParams(params),
    value,
    inclusive: false
  });
}
// @__NO_SIDE_EFFECTS__
function _gte(value, params) {
  return new $ZodCheckGreaterThan({
    check: "greater_than",
    ...normalizeParams(params),
    value,
    inclusive: true
  });
}
// @__NO_SIDE_EFFECTS__
function _multipleOf(value, params) {
  return new $ZodCheckMultipleOf({
    check: "multiple_of",
    ...normalizeParams(params),
    value
  });
}
// @__NO_SIDE_EFFECTS__
function _maxLength(maximum, params) {
  const ch = new $ZodCheckMaxLength({
    check: "max_length",
    ...normalizeParams(params),
    maximum
  });
  return ch;
}
// @__NO_SIDE_EFFECTS__
function _minLength(minimum, params) {
  return new $ZodCheckMinLength({
    check: "min_length",
    ...normalizeParams(params),
    minimum
  });
}
// @__NO_SIDE_EFFECTS__
function _length(length, params) {
  return new $ZodCheckLengthEquals({
    check: "length_equals",
    ...normalizeParams(params),
    length
  });
}
// @__NO_SIDE_EFFECTS__
function _regex(pattern, params) {
  return new $ZodCheckRegex({
    check: "string_format",
    format: "regex",
    ...normalizeParams(params),
    pattern
  });
}
// @__NO_SIDE_EFFECTS__
function _lowercase(params) {
  return new $ZodCheckLowerCase({
    check: "string_format",
    format: "lowercase",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _uppercase(params) {
  return new $ZodCheckUpperCase({
    check: "string_format",
    format: "uppercase",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _includes(includes, params) {
  return new $ZodCheckIncludes({
    check: "string_format",
    format: "includes",
    ...normalizeParams(params),
    includes
  });
}
// @__NO_SIDE_EFFECTS__
function _startsWith(prefix, params) {
  return new $ZodCheckStartsWith({
    check: "string_format",
    format: "starts_with",
    ...normalizeParams(params),
    prefix
  });
}
// @__NO_SIDE_EFFECTS__
function _endsWith(suffix, params) {
  return new $ZodCheckEndsWith({
    check: "string_format",
    format: "ends_with",
    ...normalizeParams(params),
    suffix
  });
}
// @__NO_SIDE_EFFECTS__
function _overwrite(tx) {
  return new $ZodCheckOverwrite({
    check: "overwrite",
    tx
  });
}
// @__NO_SIDE_EFFECTS__
function _normalize(form) {
  return /* @__PURE__ */ _overwrite((input) => input.normalize(form));
}
// @__NO_SIDE_EFFECTS__
function _trim() {
  return /* @__PURE__ */ _overwrite((input) => input.trim());
}
// @__NO_SIDE_EFFECTS__
function _toLowerCase() {
  return /* @__PURE__ */ _overwrite((input) => input.toLowerCase());
}
// @__NO_SIDE_EFFECTS__
function _toUpperCase() {
  return /* @__PURE__ */ _overwrite((input) => input.toUpperCase());
}
// @__NO_SIDE_EFFECTS__
function _slugify() {
  return /* @__PURE__ */ _overwrite((input) => slugify(input));
}
// @__NO_SIDE_EFFECTS__
function _array(Class2, element, params) {
  return new Class2({
    type: "array",
    element,
    // get element() {
    //   return element;
    // },
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _custom(Class2, fn2, _params) {
  const norm3 = normalizeParams(_params);
  norm3.abort ?? (norm3.abort = true);
  const schema = new Class2({
    type: "custom",
    check: "custom",
    fn: fn2,
    ...norm3
  });
  return schema;
}
// @__NO_SIDE_EFFECTS__
function _refine(Class2, fn2, _params) {
  const schema = new Class2({
    type: "custom",
    check: "custom",
    fn: fn2,
    ...normalizeParams(_params)
  });
  return schema;
}
// @__NO_SIDE_EFFECTS__
function _superRefine(fn2, params) {
  const ch = /* @__PURE__ */ _check((payload) => {
    payload.addIssue = (issue2) => {
      if (typeof issue2 === "string") {
        payload.issues.push(issue(issue2, payload.value, ch._zod.def));
      } else {
        const _issue = issue2;
        if (_issue.fatal)
          _issue.continue = false;
        _issue.code ?? (_issue.code = "custom");
        if (!("input" in _issue))
          _issue.input = payload.value;
        _issue.inst ?? (_issue.inst = ch);
        _issue.continue ?? (_issue.continue = !ch._zod.def.abort);
        payload.issues.push(issue(_issue));
      }
    };
    return fn2(payload.value, payload);
  }, params);
  return ch;
}
// @__NO_SIDE_EFFECTS__
function _check(fn2, params) {
  const ch = new $ZodCheck({
    check: "custom",
    ...normalizeParams(params)
  });
  ch._zod.check = fn2;
  return ch;
}

// node_modules/zod/v4/core/to-json-schema.js
function assignProps(target, ...sources) {
  for (const source of sources) {
    for (const key of Reflect.ownKeys(source)) {
      if (Object.prototype.propertyIsEnumerable.call(source, key)) {
        assignProp(target, key, source[key]);
      }
    }
  }
  return target;
}
function initializeContext(params) {
  let target = params?.target ?? "draft-2020-12";
  if (target === "draft-4")
    target = "draft-04";
  if (target === "draft-7")
    target = "draft-07";
  return {
    processors: params.processors ?? {},
    metadataRegistry: params?.metadata ?? globalRegistry,
    target,
    unrepresentable: params?.unrepresentable ?? "throw",
    override: params?.override ?? (() => {
    }),
    io: params?.io ?? "output",
    counter: 0,
    seen: /* @__PURE__ */ new Map(),
    sharedDefsExtractedFor: void 0,
    sharedEmitDoneFor: void 0,
    cycles: params?.cycles ?? "ref",
    reused: params?.reused ?? "inline",
    intersections: [],
    deferred: [],
    external: params?.external ?? void 0
  };
}
function handleUnrepresentable(schema, ctx, json, params, message) {
  const result = typeof ctx.unrepresentable === "function" ? ctx.unrepresentable({ zodSchema: schema, path: params.path, message }) : ctx.unrepresentable;
  if (result === "any")
    return false;
  if (result === void 0 || result === "throw")
    throw new Error(message);
  Object.assign(json, result);
  return true;
}
function processSchema(schema, ctx, _params = { path: [], schemaPath: [] }) {
  var _a3;
  const def = schema._zod.def;
  const seen = ctx.seen.get(schema);
  if (seen) {
    seen.count++;
    const isCycle = _params.schemaPath.includes(schema);
    if (isCycle) {
      seen.cycle = _params.path;
    }
    return seen.schema;
  }
  const result = { schema: {}, count: 1, cycle: void 0, path: _params.path };
  ctx.seen.set(schema, result);
  ctx.sharedDefsExtractedFor = void 0;
  ctx.sharedEmitDoneFor = void 0;
  const overrideSchema = schema._zod.toJSONSchema?.();
  if (overrideSchema) {
    result.schema = overrideSchema;
  } else {
    const params = {
      ..._params,
      schemaPath: [..._params.schemaPath, schema],
      path: _params.path
    };
    if (schema._zod.processJSONSchema) {
      schema._zod.processJSONSchema(ctx, result.schema, params);
    } else {
      const _json = result.schema;
      const processor = ctx.processors[def.type];
      if (!processor) {
        throw new Error(`[toJSONSchema]: Non-representable type encountered: ${def.type}`);
      }
      processor(schema, ctx, _json, params);
    }
    const parent = schema._zod.parent;
    if (parent) {
      if (!result.ref)
        result.ref = parent;
      processSchema(parent, ctx, params);
      ctx.seen.get(parent).isParent = true;
    }
  }
  const meta2 = ctx.metadataRegistry.get(schema);
  if (meta2)
    assignProps(result.schema, meta2);
  if (ctx.io === "input" && isTransforming(schema)) {
    delete result.schema.examples;
    delete result.schema.default;
  }
  if (ctx.io === "input" && "_prefault" in result.schema)
    (_a3 = result.schema).default ?? (_a3.default = result.schema._prefault);
  delete result.schema._prefault;
  const _result = ctx.seen.get(schema);
  return _result.schema;
}
function encodeJSONPointerSegment(segment) {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}
function extractDefs(ctx, schema) {
  const root = ctx.seen.get(schema);
  if (!root)
    throw new Error("Unprocessed schema. This is a bug in Zod.");
  if (ctx.external && ctx.sharedDefsExtractedFor === ctx.external)
    return;
  const idToSchema = /* @__PURE__ */ new Map();
  for (const entry of ctx.seen.entries()) {
    const id = ctx.metadataRegistry.get(entry[0])?.id;
    if (id) {
      const existing = idToSchema.get(id);
      if (existing && existing !== entry[0]) {
        throw new Error(`Duplicate schema id "${id}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`);
      }
      idToSchema.set(id, entry[0]);
    }
  }
  const makeURI = (entry) => {
    const defsSegment = ctx.target === "draft-2020-12" ? "$defs" : "definitions";
    if (ctx.external) {
      const externalId = ctx.external.registry.get(entry[0])?.id;
      const uriGenerator = ctx.external.uri ?? ((id2) => id2);
      if (externalId) {
        return { ref: uriGenerator(externalId) };
      }
      const id = entry[1].defId ?? entry[1].schema.id ?? `schema${ctx.counter++}`;
      entry[1].defId = id;
      return { defId: id, ref: `${uriGenerator("__shared")}#/${defsSegment}/${encodeJSONPointerSegment(id)}` };
    }
    const uriPrefix = `#`;
    const defUriPrefix = `${uriPrefix}/${defsSegment}/`;
    if (entry[1] === root && !entry[1].schema.id) {
      return { ref: uriPrefix };
    }
    const defId = entry[1].schema.id ?? `__schema${ctx.counter++}`;
    return { defId, ref: defUriPrefix + encodeJSONPointerSegment(defId) };
  };
  const extractToDef = (entry) => {
    if (entry[1].schema.$ref) {
      return;
    }
    const seen = entry[1];
    const { ref, defId } = makeURI(entry);
    seen.def = { ...seen.schema };
    if (defId)
      seen.defId = defId;
    const schema2 = seen.schema;
    for (const key in schema2) {
      delete schema2[key];
    }
    schema2.$ref = ref;
  };
  if (ctx.cycles === "throw") {
    for (const entry of ctx.seen.entries()) {
      const seen = entry[1];
      if (seen.cycle) {
        throw new Error(`Cycle detected: #/${seen.cycle?.join("/")}/<root>

Set the \`cycles\` parameter to \`"ref"\` to resolve cyclical schemas with defs.`);
      }
    }
  }
  for (const entry of ctx.seen.entries()) {
    const seen = entry[1];
    if (schema === entry[0]) {
      extractToDef(entry);
      continue;
    }
    if (ctx.external) {
      const ext = ctx.external.registry.get(entry[0])?.id;
      if (schema !== entry[0] && ext) {
        extractToDef(entry);
        continue;
      }
    }
    const id = ctx.metadataRegistry.get(entry[0])?.id;
    if (id) {
      extractToDef(entry);
      continue;
    }
    if (seen.cycle) {
      extractToDef(entry);
      continue;
    }
    if (seen.count > 1) {
      if (ctx.reused === "ref") {
        extractToDef(entry);
      }
    }
  }
  if (ctx.external)
    ctx.sharedDefsExtractedFor = ctx.external;
}
function compactTypeUnion(schema) {
  const options = schema.anyOf;
  if (!Array.isArray(options) || options.length === 0 || schema.type !== void 0)
    return;
  const types = [];
  for (const option of options) {
    if (!option || typeof option !== "object")
      return;
    compactTypeUnion(option);
    const keys = Object.keys(option);
    if (keys.length !== 1 || keys[0] !== "type")
      return;
    const type = option.type;
    for (const member of Array.isArray(type) ? type : [type]) {
      if (typeof member !== "string")
        return;
      if (!types.includes(member))
        types.push(member);
    }
  }
  delete schema.anyOf;
  schema.type = types.length === 1 ? types[0] : types;
}
var FOLDABLE_KEYS = /* @__PURE__ */ new Set(["type", "properties", "required", "additionalProperties"]);
var UNION_KEYS = ["oneOf", "anyOf"];
function undeclaredConstraint(member) {
  const extra = member.additionalProperties;
  if (extra === void 0 || extra === false || typeof extra !== "object" || extra === null)
    return null;
  return Object.keys(extra).length ? extra : null;
}
function foldObjects(members2) {
  const objects = [];
  for (const member of members2) {
    if (typeof member !== "object" || member.type !== "object")
      return null;
    for (const key in member) {
      if (!FOLDABLE_KEYS.has(key))
        return null;
    }
    objects.push(member);
  }
  const properties = {};
  const required2 = /* @__PURE__ */ new Set();
  for (const object2 of objects) {
    for (const key in object2.properties) {
      if (Object.prototype.hasOwnProperty.call(properties, key))
        continue;
      const parts = [];
      for (const other of objects) {
        const part = other.properties?.[key] ?? undeclaredConstraint(other);
        if (part === null || part === void 0)
          continue;
        if (!parts.some((seen) => JSON.stringify(seen) === JSON.stringify(part)))
          parts.push(part);
      }
      const merged = parts.length === 1 ? parts[0] : foldObjects(parts) ?? { allOf: parts };
      assignProp(properties, key, merged);
    }
    for (const key of object2.required ?? [])
      required2.add(key);
  }
  const folded = { type: "object", properties };
  if (required2.size)
    folded.required = [...required2];
  if (objects.every((object2) => object2.additionalProperties === false)) {
    folded.additionalProperties = false;
  } else {
    const constraints = [];
    for (const object2 of objects) {
      const constraint = undeclaredConstraint(object2);
      if (constraint && !constraints.some((seen) => JSON.stringify(seen) === JSON.stringify(constraint)))
        constraints.push(constraint);
    }
    if (constraints.length === 1)
      folded.additionalProperties = constraints[0];
    else if (constraints.length > 1)
      folded.additionalProperties = { allOf: constraints };
  }
  return folded;
}
function foldIntersection(json) {
  const allOf = json.allOf;
  if (!Array.isArray(allOf) || allOf.length < 2)
    return;
  for (const key of FOLDABLE_KEYS)
    if (key in json)
      return;
  const unions = allOf.filter((m) => UNION_KEYS.some((k2) => Array.isArray(m[k2])));
  let folded = null;
  if (!unions.length) {
    folded = foldObjects(allOf);
  } else {
    const union2 = unions[0];
    const keyword = UNION_KEYS.find((k2) => Array.isArray(union2[k2]));
    if (Object.keys(union2).length !== 1)
      return;
    const rest = allOf.filter((m) => m !== union2);
    const branches = union2[keyword].map((branch) => foldObjects([...rest, branch]));
    if (branches.some((b) => !b))
      return;
    folded = { [keyword]: branches };
  }
  if (!folded)
    return;
  delete json.allOf;
  assignProps(json, folded);
}
function finalize(ctx, schema) {
  const root = ctx.seen.get(schema);
  if (!root)
    throw new Error("Unprocessed schema. This is a bug in Zod.");
  const flattenRef = (zodSchema) => {
    const seen = ctx.seen.get(zodSchema);
    if (seen.ref === null)
      return;
    const schema2 = seen.def ?? seen.schema;
    const _cached = { ...schema2 };
    const ref = seen.ref;
    seen.ref = null;
    if (ref) {
      flattenRef(ref);
      const refSeen = ctx.seen.get(ref);
      const refSchema = refSeen.schema;
      if (refSchema.$ref && (ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0")) {
        schema2.allOf = schema2.allOf ?? [];
        schema2.allOf.push(refSchema);
      } else {
        assignProps(schema2, refSchema);
      }
      assignProps(schema2, _cached);
      const isParentRef = zodSchema._zod.parent === ref;
      if (isParentRef) {
        for (const key in schema2) {
          if (key === "$ref" || key === "allOf")
            continue;
          if (!(key in _cached)) {
            delete schema2[key];
          }
        }
      }
      if (refSchema.$ref && refSeen.def) {
        for (const key in schema2) {
          if (key === "$ref" || key === "allOf")
            continue;
          if (key in refSeen.def && JSON.stringify(schema2[key]) === JSON.stringify(refSeen.def[key])) {
            delete schema2[key];
          }
        }
      }
    }
    const parent = zodSchema._zod.parent;
    if (parent && parent !== ref) {
      flattenRef(parent);
      const parentSeen = ctx.seen.get(parent);
      if (parentSeen?.schema.$ref) {
        schema2.$ref = parentSeen.schema.$ref;
        if (parentSeen.def) {
          for (const key in schema2) {
            if (key === "$ref" || key === "allOf")
              continue;
            if (key in parentSeen.def && JSON.stringify(schema2[key]) === JSON.stringify(parentSeen.def[key])) {
              delete schema2[key];
            }
          }
        }
      }
    }
    ctx.override({
      zodSchema,
      jsonSchema: schema2,
      path: seen.path ?? []
    });
  };
  if (!ctx.external || ctx.sharedEmitDoneFor !== ctx.external) {
    for (const entry of [...ctx.seen.entries()].reverse()) {
      flattenRef(entry[0]);
    }
    if (ctx.target !== "openapi-3.0") {
      for (const entry of ctx.seen.entries()) {
        compactTypeUnion(entry[1].def ?? entry[1].schema);
      }
    }
    for (const rewrite of ctx.deferred)
      rewrite();
    if (ctx.intersections.length) {
      const carriers = /* @__PURE__ */ new Map();
      for (const seen of ctx.seen.values()) {
        for (const json of [seen.schema, seen.def]) {
          const allOf = json?.allOf;
          if (!Array.isArray(allOf))
            continue;
          const existing = carriers.get(allOf);
          if (existing)
            existing.push(json);
          else
            carriers.set(allOf, [json]);
        }
      }
      for (const allOf of ctx.intersections) {
        for (const json of carriers.get(allOf) ?? [])
          foldIntersection(json);
      }
    }
  }
  const result = {};
  if (ctx.target === "draft-2020-12") {
    result.$schema = "https://json-schema.org/draft/2020-12/schema";
  } else if (ctx.target === "draft-07") {
    result.$schema = "http://json-schema.org/draft-07/schema#";
  } else if (ctx.target === "draft-04") {
    result.$schema = "http://json-schema.org/draft-04/schema#";
  } else if (ctx.target === "openapi-3.0") {
  } else {
  }
  if (ctx.external?.uri) {
    const id = ctx.external.registry.get(schema)?.id;
    if (!id)
      throw new Error("Schema is missing an `id` property");
    result.$id = ctx.external.uri(id);
  }
  assignProps(result, root.defId ? root.schema : root.def ?? root.schema);
  const rootMetaId = ctx.metadataRegistry.get(schema)?.id;
  if (rootMetaId !== void 0 && result.id === rootMetaId)
    delete result.id;
  const defs = ctx.external?.defs ?? {};
  if (!ctx.external || ctx.sharedEmitDoneFor !== ctx.external) {
    for (const entry of ctx.seen.entries()) {
      const seen = entry[1];
      if (seen.def && seen.defId) {
        if (seen.def.id === seen.defId)
          delete seen.def.id;
        assignProp(defs, seen.defId, seen.def);
      }
    }
  }
  if (ctx.external)
    ctx.sharedEmitDoneFor = ctx.external;
  if (ctx.external) {
  } else {
    if (Object.keys(defs).length > 0) {
      if (ctx.target === "draft-2020-12") {
        result.$defs = defs;
      } else {
        result.definitions = defs;
      }
    }
  }
  try {
    const finalized = JSON.parse(JSON.stringify(result));
    Object.defineProperty(finalized, "~standard", {
      value: {
        ...schema["~standard"],
        jsonSchema: {
          input: createStandardJSONSchemaMethod(schema, "input", ctx.processors),
          output: createStandardJSONSchemaMethod(schema, "output", ctx.processors)
        }
      },
      enumerable: false,
      writable: false
    });
    return finalized;
  } catch (_err) {
    throw new Error("Error converting schema to JSON.");
  }
}
function isTransforming(_schema, _ctx) {
  const ctx = _ctx ?? { seen: /* @__PURE__ */ new Set() };
  if (ctx.seen.has(_schema))
    return false;
  ctx.seen.add(_schema);
  const def = _schema._zod.def;
  if (def.type === "transform")
    return true;
  if (def.type === "array")
    return isTransforming(def.element, ctx);
  if (def.type === "set")
    return isTransforming(def.valueType, ctx);
  if (def.type === "lazy")
    return isTransforming(def.getter(), ctx);
  if (def.type === "promise" || def.type === "optional" || def.type === "nonoptional" || def.type === "nullable" || def.type === "readonly" || def.type === "default" || def.type === "prefault" || def.type === "catch") {
    return isTransforming(def.innerType, ctx);
  }
  if (def.type === "intersection") {
    return isTransforming(def.left, ctx) || isTransforming(def.right, ctx);
  }
  if (def.type === "record" || def.type === "map") {
    return isTransforming(def.keyType, ctx) || isTransforming(def.valueType, ctx);
  }
  if (def.type === "pipe") {
    if (_schema._zod.traits.has("$ZodCodec"))
      return true;
    return isTransforming(def.in, ctx) || isTransforming(def.out, ctx);
  }
  if (def.type === "object") {
    for (const key in def.shape) {
      if (isTransforming(def.shape[key], ctx))
        return true;
    }
    return false;
  }
  if (def.type === "union") {
    for (const option of def.options) {
      if (isTransforming(option, ctx))
        return true;
    }
    return false;
  }
  if (def.type === "tuple") {
    for (const item of def.items) {
      if (isTransforming(item, ctx))
        return true;
    }
    if (def.rest && isTransforming(def.rest, ctx))
      return true;
    return false;
  }
  return false;
}
var createToJSONSchemaMethod = (schema, processors = {}) => (params) => {
  const ctx = initializeContext({ ...params, processors });
  processSchema(schema, ctx);
  extractDefs(ctx, schema);
  return finalize(ctx, schema);
};
var createStandardJSONSchemaMethod = (schema, io, processors = {}) => (params) => {
  const { libraryOptions, target } = params ?? {};
  const ctx = initializeContext({ ...libraryOptions ?? {}, target, io, processors });
  processSchema(schema, ctx);
  extractDefs(ctx, schema);
  return finalize(ctx, schema);
};

// node_modules/zod/v4/core/json-schema-processors.js
var narrowMin = (agg, key, value) => {
  if (agg[key] === void 0 || value > agg[key])
    agg[key] = value;
};
var narrowMax = (agg, key, value) => {
  if (agg[key] === void 0 || value < agg[key])
    agg[key] = value;
};
var narrowBoth = (agg, value) => {
  narrowMin(agg, "minimum", value);
  narrowMax(agg, "maximum", value);
};
var addDivisor = (agg, value) => {
  agg.multipleOf ?? (agg.multipleOf = []);
  if (!agg.multipleOf.includes(value))
    agg.multipleOf.push(value);
};
var addPattern = (agg, pattern) => {
  agg.patterns ?? (agg.patterns = /* @__PURE__ */ new Set());
  agg.patterns.add(pattern);
};
var intersectMime = (agg, mime) => {
  agg.mime = agg.mime ? agg.mime.filter((m) => mime.includes(m)) : [...mime];
};
var setFormat = (agg, format) => {
  agg.format = format;
  if (format.includes("int"))
    agg.isInt = true;
};
var minContributor = (agg, def) => narrowMin(agg, "minimum", def.minimum);
var maxContributor = (agg, def) => narrowMax(agg, "maximum", def.maximum);
var formatContributor = (ranges) => (agg, def) => {
  setFormat(agg, def.format);
  const [minimum, maximum] = ranges[def.format];
  narrowMin(agg, "minimum", minimum);
  narrowMax(agg, "maximum", maximum);
};
var contributors = {
  greater_than: (agg, def) => narrowMin(agg, def.inclusive ? "minimum" : "exclusiveMinimum", def.value),
  less_than: (agg, def) => narrowMax(agg, def.inclusive ? "maximum" : "exclusiveMaximum", def.value),
  multiple_of: (agg, def) => addDivisor(agg, def.value),
  number_format: formatContributor(NUMBER_FORMAT_RANGES),
  bigint_format: formatContributor(BIGINT_FORMAT_RANGES),
  min_length: minContributor,
  max_length: maxContributor,
  length_equals: (agg, def) => narrowBoth(agg, def.length),
  min_size: minContributor,
  max_size: maxContributor,
  size_equals: (agg, def) => narrowBoth(agg, def.size),
  string_format: (agg, def) => {
    setFormat(agg, def.format);
    if (def.pattern)
      addPattern(agg, def.pattern);
    if (def.format === "base64" || def.format === "base64url")
      agg.contentEncoding = def.format;
    if (def.local || def.precision === -1)
      agg.laxFormat = true;
  },
  mime_type: (agg, def) => intersectMime(agg, def.mime)
};
function aggregateChecks(schema) {
  const agg = {};
  const def = schema._zod.def;
  const list = schema._zod.traits.has("$ZodCheck") ? [schema, ...def.checks ?? []] : def.checks ?? [];
  for (const ch of list)
    contributors[ch._zod.def.check]?.(agg, ch._zod.def);
  const bag = schema._zod.bag;
  if (bag.minimum !== void 0)
    narrowMin(agg, "minimum", bag.minimum);
  if (bag.exclusiveMinimum !== void 0)
    narrowMin(agg, "exclusiveMinimum", bag.exclusiveMinimum);
  if (bag.maximum !== void 0)
    narrowMax(agg, "maximum", bag.maximum);
  if (bag.exclusiveMaximum !== void 0)
    narrowMax(agg, "exclusiveMaximum", bag.exclusiveMaximum);
  if (bag.multipleOf !== void 0)
    addDivisor(agg, bag.multipleOf);
  if (bag.format !== void 0) {
    agg.format ?? (agg.format = bag.format);
    if (bag.format.includes("int"))
      agg.isInt = true;
  }
  if (bag.mime)
    intersectMime(agg, bag.mime);
  for (const pattern of bag.patterns ?? [])
    addPattern(agg, pattern);
  return agg;
}
var formatMap = {
  guid: "uuid",
  url: "uri",
  datetime: "date-time",
  json_string: "json-string",
  regex: ""
  // do not set
};
var exactPatterns = /* @__PURE__ */ new Map([
  [base64Charset, base64],
  [base64urlCharset, base64url]
]);
var exactPattern = (p) => exactPatterns.get(p) ?? p;
var stringProcessor = (schema, ctx, _json, _params) => {
  const json = _json;
  json.type = "string";
  const { minimum, maximum, format, patterns, contentEncoding, laxFormat } = aggregateChecks(schema);
  if (typeof minimum === "number")
    json.minLength = minimum;
  if (typeof maximum === "number")
    json.maxLength = maximum;
  if (format) {
    json.format = formatMap[format] ?? format;
    if (json.format === "")
      delete json.format;
    if (format === "time" || laxFormat) {
      delete json.format;
    }
  }
  if (contentEncoding)
    json.contentEncoding = contentEncoding;
  if (patterns && patterns.size > 0) {
    const patternList = [...patterns].map(exactPattern);
    if (patternList.length === 1)
      json.pattern = patternList[0].source;
    else if (patternList.length > 1) {
      json.allOf = [
        ...patternList.map((regex) => ({
          ...ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0" ? { type: "string" } : {},
          pattern: regex.source
        }))
      ];
    }
  }
};
var numberProcessor = (schema, ctx, _json, params) => {
  const json = _json;
  const { minimum, maximum, multipleOf, exclusiveMaximum, exclusiveMinimum, isInt } = aggregateChecks(schema);
  json.type = isInt ? "integer" : "number";
  const exMin = typeof exclusiveMinimum === "number" && exclusiveMinimum >= (minimum ?? Number.NEGATIVE_INFINITY);
  const exMax = typeof exclusiveMaximum === "number" && exclusiveMaximum <= (maximum ?? Number.POSITIVE_INFINITY);
  const legacy2 = ctx.target === "draft-04" || ctx.target === "openapi-3.0";
  if (exMin) {
    if (legacy2) {
      json.minimum = exclusiveMinimum;
      json.exclusiveMinimum = true;
    } else {
      json.exclusiveMinimum = exclusiveMinimum;
    }
  } else if (typeof minimum === "number") {
    json.minimum = minimum;
  }
  if (exMax) {
    if (legacy2) {
      json.maximum = exclusiveMaximum;
      json.exclusiveMaximum = true;
    } else {
      json.exclusiveMaximum = exclusiveMaximum;
    }
  } else if (typeof maximum === "number") {
    json.maximum = maximum;
  }
  if (multipleOf) {
    const divisors = /* @__PURE__ */ new Set();
    for (const divisor of multipleOf) {
      if (Number.isFinite(divisor) && divisor !== 0)
        divisors.add(Math.abs(divisor));
      else
        handleUnrepresentable(schema, ctx, json, params, `A multipleOf divisor of ${divisor} cannot be represented in JSON Schema`);
    }
    const [first, ...rest] = divisors;
    if (first !== void 0)
      json.multipleOf = first;
    if (rest.length)
      json.allOf = [...json.allOf ?? [], ...rest.map((m) => ({ multipleOf: m }))];
  }
};
var booleanProcessor = (_schema, _ctx, json, _params) => {
  json.type = "boolean";
};
var neverProcessor = (_schema, _ctx, json, _params) => {
  json.not = {};
};
var unknownProcessor = (_schema, _ctx, _json, _params) => {
};
var enumProcessor = (schema, _ctx, json, _params) => {
  const def = schema._zod.def;
  const values = getEnumValues(def.entries);
  if (values.length === 0) {
    json.not = {};
    return;
  }
  if (values.every((v) => typeof v === "number"))
    json.type = "number";
  if (values.every((v) => typeof v === "string"))
    json.type = "string";
  json.enum = values;
};
var customProcessor = (schema, ctx, json, params) => {
  handleUnrepresentable(schema, ctx, json, params, "Custom types cannot be represented in JSON Schema");
};
var transformProcessor = (schema, ctx, json, params) => {
  handleUnrepresentable(schema, ctx, json, params, "Transforms cannot be represented in JSON Schema");
};
var arrayProcessor = (schema, ctx, _json, params) => {
  const json = _json;
  const def = schema._zod.def;
  const { minimum, maximum } = aggregateChecks(schema);
  if (typeof minimum === "number")
    json.minItems = minimum;
  if (typeof maximum === "number")
    json.maxItems = maximum;
  json.type = "array";
  json.items = processSchema(def.element, ctx, {
    ...params,
    path: [...params.path, "items"]
  });
};
function inputOptin(schema) {
  const def = schema._zod.def;
  if (def.type === "pipe" && def.in._zod.traits.has("$ZodTransform")) {
    return inputOptin(def.out);
  }
  if (def.type === "catch") {
    return inputOptin(def.innerType);
  }
  return schema._zod.optin;
}
var objectProcessor = (schema, ctx, _json, params) => {
  const json = _json;
  const def = schema._zod.def;
  const shape = def.shape;
  const symbolKeys = Object.getOwnPropertySymbols(shape);
  if (symbolKeys.length && handleUnrepresentable(schema, ctx, json, params, "Symbol keys cannot be represented in JSON Schema")) {
    return;
  }
  json.type = "object";
  json.properties = {};
  for (const key in shape) {
    assignProp(json.properties, key, processSchema(shape[key], ctx, {
      ...params,
      path: [...params.path, "properties", key]
    }));
  }
  const requiredKeys = [];
  for (const key of Object.keys(shape)) {
    const field2 = def.shape[key];
    if (ctx.io === "input" ? inputOptin(field2) === void 0 : field2._zod.optout === void 0) {
      requiredKeys.push(key);
    }
  }
  if (requiredKeys.length > 0) {
    json.required = requiredKeys;
  }
  if (def.catchall?._zod.def.type === "never") {
    json.additionalProperties = false;
  } else if (!def.catchall) {
    if (ctx.io === "output")
      json.additionalProperties = false;
  } else if (def.catchall) {
    json.additionalProperties = processSchema(def.catchall, ctx, {
      ...params,
      path: [...params.path, "additionalProperties"]
    });
  }
};
var unionProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  const isExclusive = def.inclusive === false;
  const options = def.options.map((x2, i) => processSchema(x2, ctx, {
    ...params,
    path: [...params.path, isExclusive ? "oneOf" : "anyOf", i]
  }));
  if (isExclusive) {
    json.oneOf = options;
  } else {
    json.anyOf = options;
  }
};
var intersectionProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  const a = processSchema(def.left, ctx, {
    ...params,
    path: [...params.path, "allOf", 0]
  });
  const b = processSchema(def.right, ctx, {
    ...params,
    path: [...params.path, "allOf", 1]
  });
  const isSimpleIntersection = (val) => "allOf" in val && Object.keys(val).length === 1;
  const allOf = [
    ...isSimpleIntersection(a) ? a.allOf : [a],
    ...isSimpleIntersection(b) ? b.allOf : [b]
  ];
  json.allOf = allOf;
  ctx.intersections.push(allOf);
};
var nullableProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  const inner = processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  if (ctx.target === "openapi-3.0") {
    seen.ref = def.innerType;
    json.nullable = true;
  } else {
    json.anyOf = [inner, { type: "null" }];
  }
};
var nonoptionalProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
};
var UNREPRESENTABLE_DEFAULT = /* @__PURE__ */ Symbol();
function serializeDefaultValue(value, schema, ctx, json, params) {
  let unrepresentable = false;
  const serialized = JSON.stringify(value, (_2, val) => {
    if (typeof val !== "bigint")
      return val;
    unrepresentable = true;
    return null;
  });
  if (!unrepresentable)
    return JSON.parse(serialized);
  handleUnrepresentable(schema, ctx, json, params, "BigInt defaults cannot be represented in JSON Schema");
  return UNREPRESENTABLE_DEFAULT;
}
var defaultProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  const value = serializeDefaultValue(def.defaultValue, schema, ctx, json, params);
  if (value !== UNREPRESENTABLE_DEFAULT)
    json.default = value;
};
var prefaultProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  if (ctx.io !== "input")
    return;
  const value = serializeDefaultValue(def.defaultValue, schema, ctx, json, params);
  if (value !== UNREPRESENTABLE_DEFAULT)
    json._prefault = value;
};
var catchProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  let catchValue;
  try {
    catchValue = def.catchValue(void 0);
  } catch {
    handleUnrepresentable(schema, ctx, json, params, "Dynamic catch values are not supported in JSON Schema");
    return;
  }
  json.default = catchValue;
};
var pipeProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  const inIsTransform = def.in._zod.traits.has("$ZodTransform");
  const innerType = ctx.io === "input" ? inIsTransform ? def.out : def.in : def.out;
  processSchema(innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = innerType;
};
var readonlyProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  json.readOnly = true;
};
var optionalProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
};

// node_modules/zod/v4/classic/errors.js
var _installedErrorProtos = /* @__PURE__ */ new WeakSet([Object.prototype, Error.prototype]);
function _lazyMethod(proto, key, make) {
  Object.defineProperty(proto, key, {
    configurable: true,
    enumerable: false,
    get() {
      const value = make(this);
      Object.defineProperty(this, key, { value, configurable: true, writable: true });
      return value;
    },
    set(value) {
      Object.defineProperty(this, key, { value, configurable: true, writable: true });
    }
  });
}
var initializer2 = (inst, issues) => {
  $ZodError.init(inst, issues);
  inst.name = "ZodError";
  const proto = Object.getPrototypeOf(inst);
  if (_installedErrorProtos.has(proto))
    return;
  _installedErrorProtos.add(proto);
  _lazyMethod(proto, "format", (self) => (mapper) => formatError(self, mapper));
  _lazyMethod(proto, "flatten", (self) => (mapper) => flattenError(self, mapper));
  _lazyMethod(proto, "addIssue", (self) => (issue2) => {
    self.issues.push(issue2);
    self.message = JSON.stringify(self.issues, jsonStringifyReplacer, 2);
  });
  _lazyMethod(proto, "addIssues", (self) => (issues2) => {
    self.issues.push(...issues2);
    self.message = JSON.stringify(self.issues, jsonStringifyReplacer, 2);
  });
  Object.defineProperty(proto, "isEmpty", {
    configurable: true,
    enumerable: false,
    get() {
      return this.issues.length === 0;
    }
  });
};
var ZodRealError = /* @__PURE__ */ $constructor("ZodError", initializer2, void 0, {
  Parent: Error
});

// node_modules/zod/v4/classic/parse.js
var parse = /* @__PURE__ */ _parse(ZodRealError);
var parseAsync = /* @__PURE__ */ _parseAsync(ZodRealError);
var safeParse = /* @__PURE__ */ _safeParse(ZodRealError);
var safeParseAsync = /* @__PURE__ */ _safeParseAsync(ZodRealError);
var encode = /* @__PURE__ */ _encode(ZodRealError);
var decode = /* @__PURE__ */ _decode(ZodRealError);
var encodeAsync = /* @__PURE__ */ _encodeAsync(ZodRealError);
var decodeAsync = /* @__PURE__ */ _decodeAsync(ZodRealError);
var safeEncode = /* @__PURE__ */ _safeEncode(ZodRealError);
var safeDecode = /* @__PURE__ */ _safeDecode(ZodRealError);
var safeEncodeAsync = /* @__PURE__ */ _safeEncodeAsync(ZodRealError);
var safeDecodeAsync = /* @__PURE__ */ _safeDecodeAsync(ZodRealError);

// node_modules/zod/v4/classic/schemas.js
function _ensureDefaultLocale() {
  if (!globalConfig.localeError)
    config(en_default());
}
function _ensureDefaultMemoizer() {
  if (!globalConfig.memoizer)
    config({ memoizer: memoizer() });
}
var ZodType = /* @__PURE__ */ $constructor("ZodType", (inst, def) => {
  _ensureDefaultLocale();
  $ZodType.init(inst, def);
  inst.def = def;
  inst.type = def.type;
  return inst;
}, {
  check(...chks) {
    const def = this.def;
    return this.clone(util_exports.mergeDefs(def, {
      checks: [
        ...def.checks ?? [],
        ...chks.map((ch) => typeof ch === "function" ? { _zod: { check: ch, def: { check: "custom" }, onattach: [] } } : ch)
      ]
    }), { parent: true });
  },
  with(...chks) {
    return this.check(...chks);
  },
  clone(def, params) {
    return clone(this, def, params);
  },
  brand() {
    return this;
  },
  register(reg, meta2) {
    reg.add(this, meta2);
    return this;
  },
  refine(check, params) {
    return this.check(refine(check, params));
  },
  superRefine(refinement, params) {
    return this.check(superRefine(refinement, params));
  },
  overwrite(fn2) {
    return this.check(_overwrite(fn2));
  },
  optional() {
    return optional(this);
  },
  exactOptional() {
    return exactOptional(this);
  },
  nullable() {
    return nullable(this);
  },
  nullish() {
    return optional(nullable(this));
  },
  nonoptional(params) {
    return nonoptional(this, params);
  },
  array() {
    return array(this);
  },
  or(arg) {
    return union([this, arg]);
  },
  and(arg) {
    return intersection(this, arg);
  },
  transform(tx) {
    return pipe(this, transform(tx));
  },
  default(d) {
    return _default(this, d);
  },
  prefault(d) {
    return prefault(this, d);
  },
  catch(params) {
    return _catch(this, params);
  },
  pipe(target) {
    return pipe(this, target);
  },
  readonly() {
    return readonly(this);
  },
  describe(description) {
    const cl = this.clone();
    globalRegistry.add(cl, { description });
    return cl;
  },
  meta(...args) {
    if (args.length === 0)
      return globalRegistry.get(this);
    const cl = this.clone();
    globalRegistry.add(cl, args[0]);
    return cl;
  },
  isOptional() {
    return this.safeParse(void 0).success;
  },
  isNullable() {
    return this.safeParse(null).success;
  },
  apply(fn2, ...args) {
    return args.length === 0 ? fn2(this) : fn2(this, ...args);
  },
  // Overrides core's `~standard` to add `jsonSchema`. Must stay a prototype entry: redefining it per instance demotes instances to dictionary mode.
  get "~standard"() {
    return util_exports.hide(this, "~standard", {
      ...standardProps(this),
      jsonSchema: {
        input: createStandardJSONSchemaMethod(this, "input"),
        output: createStandardJSONSchemaMethod(this, "output")
      }
    });
  },
  set "~standard"(value) {
    util_exports.own(this, "~standard", value);
  },
  parse: function _parse2(data, params) {
    return parse(this, data, params, { callee: _parse2 });
  },
  parseAsync: async function _parseAsync2(data, params) {
    return await parseAsync(this, data, params, { callee: _parseAsync2 });
  },
  safeParse(data, params) {
    return safeParse(this, data, params);
  },
  async safeParseAsync(data, params) {
    return safeParseAsync(this, data, params);
  },
  // `spa` is an alias: same function object as `safeParseAsync`, as before.
  get spa() {
    return this?.safeParseAsync;
  },
  set spa(value) {
    util_exports.own(this, "spa", value);
  },
  validate(data, params) {
    return validate(this, data, params);
  },
  validateAsync(data, params) {
    return validateAsync(this, data, params);
  },
  encode: function _encode2(data, params) {
    return encode(this, data, params, { callee: _encode2 });
  },
  decode: function _decode2(data, params) {
    return decode(this, data, params, { callee: _decode2 });
  },
  encodeAsync: async function _encodeAsync2(data, params) {
    return await encodeAsync(this, data, params, { callee: _encodeAsync2 });
  },
  decodeAsync: async function _decodeAsync2(data, params) {
    return await decodeAsync(this, data, params, { callee: _decodeAsync2 });
  },
  safeEncode(data, params) {
    return safeEncode(this, data, params);
  },
  safeDecode(data, params) {
    return safeDecode(this, data, params);
  },
  async safeEncodeAsync(data, params) {
    return safeEncodeAsync(this, data, params);
  },
  async safeDecodeAsync(data, params) {
    return safeDecodeAsync(this, data, params);
  },
  toJSONSchema(params) {
    return createToJSONSchemaMethod(this, {})(params);
  },
  // Reads through to the registry on every access, so it must not cache.
  get description() {
    return globalRegistry.get(this)?.description;
  },
  // No setter: `schema._def = x` throws, as it did when `_def` was a non-writable own property.
  get _def() {
    return this._zod.def;
  }
});
var _ZodString = /* @__PURE__ */ $constructor(
  "_ZodString",
  (inst, def) => {
    $ZodString.init(inst, def);
    ZodType.init(inst, def);
    inst._zod.processJSONSchema = (ctx, json, params) => stringProcessor(inst, ctx, json, params);
  },
  /* @__PURE__ */ util_exports.derived({
    format: (inst) => aggregateChecks(inst).format ?? null,
    minLength: (inst) => aggregateChecks(inst).minimum ?? null,
    maxLength: (inst) => aggregateChecks(inst).maximum ?? null
  }, {
    regex(...args) {
      return this.check(_regex(...args));
    },
    includes(...args) {
      return this.check(_includes(...args));
    },
    startsWith(...args) {
      return this.check(_startsWith(...args));
    },
    endsWith(...args) {
      return this.check(_endsWith(...args));
    },
    min(...args) {
      return this.check(_minLength(...args));
    },
    max(...args) {
      return this.check(_maxLength(...args));
    },
    length(...args) {
      return this.check(_length(...args));
    },
    nonempty(...args) {
      return this.check(_minLength(1, ...args));
    },
    lowercase(params) {
      return this.check(_lowercase(params));
    },
    uppercase(params) {
      return this.check(_uppercase(params));
    },
    trim() {
      return this.check(_trim());
    },
    normalize(...args) {
      return this.check(_normalize(...args));
    },
    toLowerCase() {
      return this.check(_toLowerCase());
    },
    toUpperCase() {
      return this.check(_toUpperCase());
    },
    slugify() {
      return this.check(_slugify());
    }
  })
);
var ZodString = /* @__PURE__ */ $constructor("ZodString", (inst, def) => {
  $ZodString.init(inst, def);
  _ZodString.init(inst, def);
}, {
  email(params) {
    return this.check(_email(ZodEmail, params));
  },
  url(params) {
    return this.check(_url(ZodURL, params));
  },
  jwt(params) {
    return this.check(_jwt(ZodJWT, params));
  },
  emoji(params) {
    return this.check(_emoji2(ZodEmoji, params));
  },
  guid(params) {
    return this.check(_guid(ZodGUID, params));
  },
  uuid(params) {
    return this.check(_uuid(ZodUUID, params));
  },
  uuidv4(params) {
    return this.check(_uuidv4(ZodUUID, params));
  },
  uuidv6(params) {
    return this.check(_uuidv6(ZodUUID, params));
  },
  uuidv7(params) {
    return this.check(_uuidv7(ZodUUID, params));
  },
  nanoid(params) {
    return this.check(_nanoid(ZodNanoID, params));
  },
  cuid(params) {
    return this.check(_cuid(ZodCUID, params));
  },
  cuid2(params) {
    return this.check(_cuid2(ZodCUID2, params));
  },
  ulid(params) {
    return this.check(_ulid(ZodULID, params));
  },
  base64(params) {
    return this.check(_base64(ZodBase64, params));
  },
  base64url(params) {
    return this.check(_base64url(ZodBase64URL, params));
  },
  xid(params) {
    return this.check(_xid(ZodXID, params));
  },
  ksuid(params) {
    return this.check(_ksuid(ZodKSUID, params));
  },
  ipv4(params) {
    return this.check(_ipv4(ZodIPv4, params));
  },
  ipv6(params) {
    return this.check(_ipv6(ZodIPv6, params));
  },
  cidrv4(params) {
    return this.check(_cidrv4(ZodCIDRv4, params));
  },
  cidrv6(params) {
    return this.check(_cidrv6(ZodCIDRv6, params));
  },
  e164(params) {
    return this.check(_e164(ZodE164, params));
  },
  datetime(params) {
    return this.check(_isoDateTime(ZodISODateTime, params));
  },
  date(params) {
    return this.check(_isoDate(ZodISODate, params));
  },
  time(params) {
    return this.check(_isoTime(ZodISOTime, params));
  },
  duration(params) {
    return this.check(_isoDuration(ZodISODuration, params));
  }
});
function string2(params) {
  return _string(ZodString, params);
}
var ZodStringFormat = /* @__PURE__ */ $constructor("ZodStringFormat", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  _ZodString.init(inst, def);
});
var ZodISODateTime = /* @__PURE__ */ $constructor("ZodISODateTime", (inst, def) => {
  $ZodISODateTime.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodISODate = /* @__PURE__ */ $constructor("ZodISODate", (inst, def) => {
  $ZodISODate.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodISOTime = /* @__PURE__ */ $constructor("ZodISOTime", (inst, def) => {
  $ZodISOTime.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodISODuration = /* @__PURE__ */ $constructor("ZodISODuration", (inst, def) => {
  $ZodISODuration.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodEmail = /* @__PURE__ */ $constructor("ZodEmail", (inst, def) => {
  $ZodEmail.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodGUID = /* @__PURE__ */ $constructor("ZodGUID", (inst, def) => {
  $ZodGUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodUUID = /* @__PURE__ */ $constructor("ZodUUID", (inst, def) => {
  $ZodUUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodURL = /* @__PURE__ */ $constructor("ZodURL", (inst, def) => {
  $ZodURL.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodEmoji = /* @__PURE__ */ $constructor("ZodEmoji", (inst, def) => {
  $ZodEmoji.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodNanoID = /* @__PURE__ */ $constructor("ZodNanoID", (inst, def) => {
  $ZodNanoID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCUID = /* @__PURE__ */ $constructor("ZodCUID", (inst, def) => {
  $ZodCUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCUID2 = /* @__PURE__ */ $constructor("ZodCUID2", (inst, def) => {
  $ZodCUID2.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodULID = /* @__PURE__ */ $constructor("ZodULID", (inst, def) => {
  $ZodULID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodXID = /* @__PURE__ */ $constructor("ZodXID", (inst, def) => {
  $ZodXID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodKSUID = /* @__PURE__ */ $constructor("ZodKSUID", (inst, def) => {
  $ZodKSUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodIPv4 = /* @__PURE__ */ $constructor("ZodIPv4", (inst, def) => {
  $ZodIPv4.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodIPv6 = /* @__PURE__ */ $constructor("ZodIPv6", (inst, def) => {
  $ZodIPv6.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCIDRv4 = /* @__PURE__ */ $constructor("ZodCIDRv4", (inst, def) => {
  $ZodCIDRv4.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCIDRv6 = /* @__PURE__ */ $constructor("ZodCIDRv6", (inst, def) => {
  $ZodCIDRv6.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodBase64 = /* @__PURE__ */ $constructor("ZodBase64", (inst, def) => {
  $ZodBase64.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodBase64URL = /* @__PURE__ */ $constructor("ZodBase64URL", (inst, def) => {
  $ZodBase64URL.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodE164 = /* @__PURE__ */ $constructor("ZodE164", (inst, def) => {
  $ZodE164.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodJWT = /* @__PURE__ */ $constructor("ZodJWT", (inst, def) => {
  $ZodJWT.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodNumber = /* @__PURE__ */ $constructor(
  "ZodNumber",
  (inst, def) => {
    $ZodNumber.init(inst, def);
    ZodType.init(inst, def);
    inst._zod.processJSONSchema = (ctx, json, params) => numberProcessor(inst, ctx, json, params);
    inst.isFinite = true;
  },
  /* @__PURE__ */ util_exports.derived({
    minValue: (inst) => {
      const { minimum, exclusiveMinimum } = aggregateChecks(inst);
      return Math.max(minimum ?? Number.NEGATIVE_INFINITY, exclusiveMinimum ?? Number.NEGATIVE_INFINITY);
    },
    maxValue: (inst) => {
      const { maximum, exclusiveMaximum } = aggregateChecks(inst);
      return Math.min(maximum ?? Number.POSITIVE_INFINITY, exclusiveMaximum ?? Number.POSITIVE_INFINITY);
    },
    isInt: (inst) => {
      const { isInt, multipleOf } = aggregateChecks(inst);
      return !!isInt || !!multipleOf?.some(Number.isSafeInteger);
    },
    format: (inst) => aggregateChecks(inst).format ?? null
  }, {
    gt(value, params) {
      return this.check(_gt(value, params));
    },
    gte(value, params) {
      return this.check(_gte(value, params));
    },
    min(value, params) {
      return this.check(_gte(value, params));
    },
    lt(value, params) {
      return this.check(_lt(value, params));
    },
    lte(value, params) {
      return this.check(_lte(value, params));
    },
    max(value, params) {
      return this.check(_lte(value, params));
    },
    int(params) {
      return this.check(int(params));
    },
    safe(params) {
      return this.check(int(params));
    },
    positive(params) {
      return this.check(_gt(0, params));
    },
    nonnegative(params) {
      return this.check(_gte(0, params));
    },
    negative(params) {
      return this.check(_lt(0, params));
    },
    nonpositive(params) {
      return this.check(_lte(0, params));
    },
    multipleOf(value, params) {
      return this.check(_multipleOf(value, params));
    },
    step(value, params) {
      return this.check(_multipleOf(value, params));
    },
    finite() {
      return this;
    }
  })
);
function number2(params) {
  return _number(ZodNumber, params);
}
var ZodNumberFormat = /* @__PURE__ */ $constructor("ZodNumberFormat", (inst, def) => {
  $ZodNumberFormat.init(inst, def);
  ZodNumber.init(inst, def);
});
function int(params) {
  return _int(ZodNumberFormat, params);
}
var ZodBoolean = /* @__PURE__ */ $constructor("ZodBoolean", (inst, def) => {
  $ZodBoolean.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => booleanProcessor(inst, ctx, json, params);
});
function boolean2(params) {
  return _boolean(ZodBoolean, params);
}
var ZodUnknown = /* @__PURE__ */ $constructor("ZodUnknown", (inst, def) => {
  $ZodUnknown.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => unknownProcessor(inst, ctx, json, params);
});
function unknown() {
  return _unknown(ZodUnknown);
}
var ZodNever = /* @__PURE__ */ $constructor("ZodNever", (inst, def) => {
  $ZodNever.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => neverProcessor(inst, ctx, json, params);
});
function never(params) {
  return _never(ZodNever, params);
}
var ZodArray = /* @__PURE__ */ $constructor("ZodArray", (inst, def) => {
  _ensureDefaultMemoizer();
  $ZodArray.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => arrayProcessor(inst, ctx, json, params);
  inst.element = def.element;
}, {
  min(n, params) {
    return this.check(_minLength(n, params));
  },
  nonempty(params) {
    return this.check(_minLength(1, params));
  },
  max(n, params) {
    return this.check(_maxLength(n, params));
  },
  length(n, params) {
    return this.check(_length(n, params));
  },
  unwrap() {
    return this.element;
  }
});
function array(element, params) {
  return _array(ZodArray, element, params);
}
var ZodObject = /* @__PURE__ */ $constructor("ZodObject", (inst, def) => {
  _ensureDefaultMemoizer();
  $ZodObjectJIT.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => objectProcessor(inst, ctx, json, params);
  util_exports.installLazyProp(inst, "shape", (self) => self._zod.def.shape, false);
}, {
  keyof() {
    return _enum(Object.keys(this._zod.def.shape));
  },
  catchall(catchall) {
    return this.clone(util_exports.mergeDefs(this._zod.def, { catchall }));
  },
  passthrough() {
    return this.clone(util_exports.mergeDefs(this._zod.def, { catchall: unknown() }));
  },
  loose() {
    return this.clone(util_exports.mergeDefs(this._zod.def, { catchall: unknown() }));
  },
  strict() {
    return this.clone(util_exports.mergeDefs(this._zod.def, { catchall: never() }));
  },
  strip() {
    return this.clone(util_exports.mergeDefs(this._zod.def, { catchall: void 0 }));
  },
  extend(incoming) {
    return util_exports.extend(this, incoming);
  },
  safeExtend(incoming) {
    return util_exports.safeExtend(this, incoming);
  },
  merge(other) {
    return util_exports.merge(this, other);
  },
  pick(mask) {
    return util_exports.pick(this, mask);
  },
  omit(mask) {
    return util_exports.omit(this, mask);
  },
  partial(...args) {
    return util_exports.partial(ZodOptional, this, args[0]);
  },
  exactPartial(...args) {
    return util_exports.partial(ZodExactOptional, this, args[0], "exactPartial");
  },
  required(...args) {
    return util_exports.required(ZodNonOptional, this, args[0]);
  }
});
function object(shape, params) {
  const def = {
    type: "object",
    shape: shape ?? {},
    ...util_exports.normalizeParams(params)
  };
  return new ZodObject(def);
}
var ZodUnion = /* @__PURE__ */ $constructor("ZodUnion", (inst, def) => {
  $ZodUnion.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => unionProcessor(inst, ctx, json, params);
  inst.options = def.options;
});
function union(options, params) {
  return new ZodUnion({
    type: "union",
    options,
    ...util_exports.normalizeParams(params)
  });
}
var ZodIntersection = /* @__PURE__ */ $constructor("ZodIntersection", (inst, def) => {
  $ZodIntersection.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => intersectionProcessor(inst, ctx, json, params);
});
function intersection(left, right) {
  return new ZodIntersection({
    type: "intersection",
    left,
    right
  });
}
var ZodEnum = /* @__PURE__ */ $constructor("ZodEnum", (inst, def) => {
  $ZodEnum.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => enumProcessor(inst, ctx, json, params);
  inst.enum = def.entries;
  inst.options = [...inst._zod.values];
  const keys = new Set(Object.keys(def.entries));
  inst.extract = (values, params) => {
    const newEntries = {};
    for (const value of values) {
      if (keys.has(value)) {
        newEntries[value] = def.entries[value];
      } else
        throw new Error(`Key ${value} not found in enum`);
    }
    return new ZodEnum({
      ...def,
      checks: [],
      ...util_exports.normalizeParams(params),
      entries: newEntries
    });
  };
  inst.exclude = (values, params) => {
    const newEntries = { ...def.entries };
    for (const value of values) {
      if (keys.has(value)) {
        delete newEntries[value];
      } else
        throw new Error(`Key ${value} not found in enum`);
    }
    return new ZodEnum({
      ...def,
      checks: [],
      ...util_exports.normalizeParams(params),
      entries: newEntries
    });
  };
});
function _enum(values, params) {
  const entries2 = Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values;
  return new ZodEnum({
    type: "enum",
    entries: entries2,
    ...util_exports.normalizeParams(params)
  });
}
var ZodTransform = /* @__PURE__ */ $constructor("ZodTransform", (inst, def) => {
  _ensureDefaultMemoizer();
  $ZodTransform.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => transformProcessor(inst, ctx, json, params);
  inst._zod.parse = (payload, _ctx) => {
    if (_ctx.direction === "backward") {
      throw new $ZodEncodeError(inst.constructor.name);
    }
    payload.addIssue = (issue2) => {
      if (typeof issue2 === "string") {
        payload.issues.push(util_exports.issue(issue2, payload.value, def));
      } else {
        const _issue = issue2;
        if (_issue.fatal)
          _issue.continue = false;
        _issue.code ?? (_issue.code = "custom");
        if (!("input" in _issue))
          _issue.input = payload.value;
        _issue.inst ?? (_issue.inst = inst);
        payload.issues.push(util_exports.issue(_issue));
      }
    };
    const output = def.transform(payload.value, payload);
    if (output instanceof Promise) {
      return output.then((output2) => {
        payload.value = output2;
        return payload;
      });
    }
    payload.value = output;
    return payload;
  };
});
function transform(fn2) {
  return new ZodTransform({
    type: "transform",
    transform: fn2
  });
}
var ZodOptional = /* @__PURE__ */ $constructor("ZodOptional", (inst, def) => {
  $ZodOptional.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function optional(innerType) {
  return new ZodOptional({
    type: "optional",
    innerType
  });
}
var ZodExactOptional = /* @__PURE__ */ $constructor("ZodExactOptional", (inst, def) => {
  $ZodExactOptional.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function exactOptional(innerType) {
  return new ZodExactOptional({
    type: "optional",
    innerType
  });
}
var ZodNullable = /* @__PURE__ */ $constructor("ZodNullable", (inst, def) => {
  $ZodNullable.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => nullableProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function nullable(innerType) {
  return new ZodNullable({
    type: "nullable",
    innerType
  });
}
var ZodDefault = /* @__PURE__ */ $constructor("ZodDefault", (inst, def) => {
  $ZodDefault.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => defaultProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
  inst.removeDefault = inst.unwrap;
});
function _default(innerType, defaultValue) {
  return new ZodDefault({
    type: "default",
    innerType,
    get defaultValue() {
      return typeof defaultValue === "function" ? defaultValue() : util_exports.shallowClone(defaultValue);
    }
  });
}
var ZodPrefault = /* @__PURE__ */ $constructor("ZodPrefault", (inst, def) => {
  $ZodPrefault.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => prefaultProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function prefault(innerType, defaultValue) {
  return new ZodPrefault({
    type: "prefault",
    innerType,
    get defaultValue() {
      return typeof defaultValue === "function" ? defaultValue() : util_exports.shallowClone(defaultValue);
    }
  });
}
var ZodNonOptional = /* @__PURE__ */ $constructor("ZodNonOptional", (inst, def) => {
  $ZodNonOptional.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => nonoptionalProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function nonoptional(innerType, params) {
  return new ZodNonOptional({
    type: "nonoptional",
    innerType,
    ...util_exports.normalizeParams(params)
  });
}
var ZodCatch = /* @__PURE__ */ $constructor("ZodCatch", (inst, def) => {
  $ZodCatch.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => catchProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
  inst.removeCatch = inst.unwrap;
});
function _catch(innerType, catchValue) {
  return new ZodCatch({
    type: "catch",
    innerType,
    catchValue: typeof catchValue === "function" ? catchValue : util_exports.constantCatch(catchValue)
  });
}
var ZodPipe = /* @__PURE__ */ $constructor("ZodPipe", (inst, def) => {
  $ZodPipe.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => pipeProcessor(inst, ctx, json, params);
  inst.in = def.in;
  inst.out = def.out;
});
function pipe(in_, out) {
  return new ZodPipe({
    type: "pipe",
    in: in_,
    out
    // ...util.normalizeParams(params),
  });
}
var ZodReadonly = /* @__PURE__ */ $constructor("ZodReadonly", (inst, def) => {
  $ZodReadonly.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => readonlyProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function readonly(innerType) {
  return new ZodReadonly({
    type: "readonly",
    innerType
  });
}
var ZodCustom = /* @__PURE__ */ $constructor("ZodCustom", (inst, def) => {
  $ZodCustom.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => customProcessor(inst, ctx, json, params);
});
function custom(fn2, _params) {
  return _custom(ZodCustom, fn2 ?? (() => true), _params);
}
function refine(fn2, _params = {}) {
  return _refine(ZodCustom, fn2, _params);
}
function superRefine(fn2, params) {
  return _superRefine(fn2, params);
}

// src/lib/types.ts
var TASK_STATUSES = ["free", "claimed", "in_progress", "blocked", "done", "orphaned"];
var TRACK_COLORS = ["blue", "mauve", "teal", "pink", "sky", "flamingo"];
var PHASE_GOAL_MAX = 300;
var PLAN_HISTORY_MAX = { entries: 30, why: 300, changes: 20, change: 200 };
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

// src/lib/decisions.ts
var DECISION_POINTS = [
  "route",
  "triage",
  "design-apply",
  "design-approve",
  "plan-confirm",
  "mode",
  "ruling",
  "safe-path",
  "takeover",
  "revert",
  "blocked",
  "trust",
  "approve",
  "idea",
  "replan",
  "vision",
  "other"
];
var LIMITS = { what: 200, chosen: 200, alternative: 200, alternatives: 10, why: 500, revert: 500, safePath: 200, reason: 300, whyNot: 300, tradeoffs: 300, ifWrong: 200 };
var DECISIONS_MAX = 16 * 1024;
var DECISIONS_WINDOW_MS = 24 * 36e5;
var FUTURE_SKEW_MS = 5 * 6e4;
var isObj = (x2) => !!x2 && typeof x2 === "object" && !Array.isArray(x2);
var str = (x2) => typeof x2 === "string";
var cp = (n) => String.fromCharCode(n);
var UNSAFE = new RegExp(`[\\x00-\\x1f\\x7f-\\x9f${cp(8234)}-${cp(8238)}${cp(8294)}-${cp(8297)}]`, "g");
var clean = (s, max) => {
  const t = s.replace(UNSAFE, " ").replace(/\s+/g, " ").trim();
  return t.length <= max ? t : Array.from(t).slice(0, max).join("");
};
var text = (x2, max) => str(x2) ? clean(x2, max) || null : null;
function normalizeAlternative(x2) {
  if (str(x2)) {
    const option2 = clean(x2, LIMITS.alternative);
    return option2 ? { option: option2 } : null;
  }
  if (!isObj(x2)) return null;
  const option = text(x2.option, LIMITS.alternative);
  if (!option) return null;
  const whyNot = text(x2.whyNot, LIMITS.whyNot);
  const tradeoffs = text(x2.tradeoffs, LIMITS.tradeoffs);
  return { option, ...whyNot ? { whyNot } : {}, ...tradeoffs ? { tradeoffs } : {} };
}

// src/lib/plan-history.ts
function fitText(s, max) {
  const t = clean(s, max);
  if (t.length <= max) return t;
  let out = "";
  for (const ch of t) {
    if (out.length + ch.length > max) break;
    out += ch;
  }
  return out;
}
function historyOf(x2) {
  if (!Array.isArray(x2)) return void 0;
  const out = [];
  for (const e of x2) {
    if (!e || typeof e !== "object" || Array.isArray(e)) continue;
    const { at: at2, why, changes } = e;
    if (typeof at2 !== "string" || typeof why !== "string" || !Array.isArray(changes)) continue;
    const lines2 = changes.filter((c) => typeof c === "string").slice(0, PLAN_HISTORY_MAX.changes);
    out.push({ at: at2, why: fitText(why, PLAN_HISTORY_MAX.why), changes: lines2.map((c) => fitText(c, PLAN_HISTORY_MAX.change)) });
  }
  return out.slice(-PLAN_HISTORY_MAX.entries);
}

// src/lib/plan.ts
function planSchemas() {
  const id = string2().regex(PLAN_ID_RE, "invalid id (allowed: letters, digits, _ - .; max 64)").refine((s) => s !== "." && s !== "..", "invalid id");
  const TaskSchema = object({
    id,
    title: string2().min(1),
    track: id,
    phase: id,
    category: string2().optional(),
    includes: string2().optional(),
    done_when: string2().min(1),
    verification: string2().optional(),
    depends_on: array(id).default([]),
    zones: array(string2().min(1)).default([]),
    estimate_min: number2().positive().optional(),
    delicate: boolean2().optional(),
    // G-25, K3-08: the section of the design the task comes from (a heading's slug, or _intro).
    design_ref: string2().regex(/^[a-z0-9-]{1,80}$|^_intro$/, "design_ref must be a section slug of the design").optional(),
    // A7: the failure modes no test covers, one line each, which the brief hands to the implementer and the reviewers.
    review_focus: array(string2().trim().min(1).max(300).regex(/^[^\r\n]*$/, "one line each")).min(1).max(6).optional()
  });
  const PlanSchema = object({
    project: id,
    locale: string2().min(1).default("en"),
    version: string2().min(1),
    design_version: number2().int().positive().optional(),
    artifacts: object({ roadmap: string2().url().optional(), design: string2().url().optional() }).default({}),
    versions: array(object({ id, phases: array(id), target: string2().refine(realDate, "target must be a date (YYYY-MM-DD)").optional() })).default([]),
    tracks: array(object({ id, name: string2().min(1), color: _enum(TRACK_COLORS) })).min(1),
    phases: array(object({
      id,
      name: string2().min(1),
      plan_status: _enum(["committed", "provisional"]).default("committed"),
      goal: string2().max(PHASE_GOAL_MAX).optional()
    })).min(1),
    tasks: array(TaskSchema).min(1),
    // T6B3-RETIRED-IDS: the tasks `waypoint replan` retired, whose ids are never minted again. The history (what replan
    // changed and why) is read apart by historyOf, leniently; the roadmap's documents leave both out.
    retired: array(id).optional()
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
function parsePlan(text3) {
  let raw;
  try {
    raw = (0, import_yaml.parse)(text3);
  } catch (e) {
    throw new PlanError([`YAML: ${e.message}`]);
  }
  const r2 = schemas().PlanSchema.safeParse(raw);
  if (!r2.success) throw new PlanError(r2.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`));
  const history = historyOf(raw.history);
  const plan = history ? { ...r2.data, history } : r2.data;
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
  for (const id of plan.retired ?? []) if (tasks.has(id)) issues.push(`task ${id}: the id is retired (a replan took that task out): give the task a new id`);
  const cycle = findCycle(plan);
  if (cycle) issues.push(`dependency cycle: ${cycle.join(" -> ")}`);
  return issues;
}
function findCycle(plan) {
  const deps = new Map(plan.tasks.map((t) => [t.id, t.depends_on]));
  const mark = /* @__PURE__ */ new Map();
  const stack = [];
  const visit2 = (n) => {
    if (mark.get(n) === 2) return null;
    if (mark.get(n) === 1) return [...stack.slice(stack.indexOf(n)), n];
    mark.set(n, 1);
    stack.push(n);
    for (const d of deps.get(n) ?? []) {
      const c = visit2(d);
      if (c) return c;
    }
    stack.pop();
    mark.set(n, 2);
    return null;
  };
  for (const t of plan.tasks) {
    const c = visit2(t.id);
    if (c) return c;
  }
  return null;
}

// src/lib/replan.ts
var import_yaml2 = __toESM(require_dist(), 1);
var REPLAN_OPS = ["add-phase", "edit-phase", "order-phases", "move", "order-tasks", "edit", "retire"];
var MAX_OPS = 50;
var TEXT_MAX = { name: 200, doneWhen: 500, why: 200 };
var PHASE_FIELDS = ["name", "goal", "plan_status"];
var TASK_FIELDS = ["title", "done_when", "depends_on", "estimate_min"];
var EMPTY = "ops: empty (keeping the plan as it is needs no replan)";
var TOO_MANY = (n) => `ops: ${n} operations, at most ${MAX_OPS}`;
var ReplanError = class extends Error {
  constructor(issues) {
    super(`replan: refused, the plan is unchanged:
- ${issues.join("\n- ")}`);
    this.issues = issues;
    this.name = "ReplanError";
  }
  issues;
};
var isObj2 = (x2) => !!x2 && typeof x2 === "object" && !Array.isArray(x2);
var planId = (x2) => typeof x2 === "string" && isPlanId(x2);
var text2 = (max) => (x2) => typeof x2 === "string" ? fitText(x2, max) || null : null;
var idList = (x2) => Array.isArray(x2) && x2.every(planId) ? x2 : null;
var status = (x2) => x2 === "committed" || x2 === "provisional" ? x2 : null;
var minutes = (x2) => typeof x2 === "number" && Number.isFinite(x2) && x2 > 0 ? x2 : null;
var dropUndefined = (x2) => Object.fromEntries(Object.entries(x2).filter(([, v]) => v !== void 0));
function readOp(o) {
  if (!isObj2(o)) return { error: "not an object" };
  const kind = o.op;
  if (typeof kind !== "string" || !REPLAN_OPS.includes(kind)) {
    return { error: `unknown op ${typeof kind === "string" ? JSON.stringify(clean(kind, 40)) : "(none)"}` };
  }
  const wrong = [];
  const id = (k3) => {
    const v = o[k3];
    if (planId(v)) return v;
    wrong.push(`${k3} must be a plan id`);
    return "";
  };
  const required2 = (k3, max) => {
    const v = text2(max)(o[k3]);
    if (v === null) wrong.push(`${k3} must be a non-empty text`);
    return v ?? "";
  };
  const order = (k3) => {
    const v = idList(o[k3]);
    if (!v?.length) wrong.push(`${k3} must be a non-empty list of plan ids`);
    return v ?? [];
  };
  const optional2 = (k3, read2, what) => {
    if (o[k3] === void 0) return void 0;
    const v = read2(o[k3]);
    if (v === null) wrong.push(`${k3} ${what}`);
    return v ?? void 0;
  };
  const optText = (k3, max) => optional2(k3, text2(max), "must be a non-empty text");
  const optStatus = () => optional2("plan_status", status, "must be committed or provisional");
  const none = (fields) => {
    if (fields.every((f) => o[f] === void 0)) wrong.push(`nothing to change: give ${fields.join(", ")}`);
  };
  let op;
  const k2 = kind;
  switch (k2) {
    case "add-phase":
      op = {
        op: k2,
        id: id("id"),
        name: required2("name", TEXT_MAX.name),
        goal: optText("goal", PHASE_GOAL_MAX),
        after: optional2("after", (x2) => planId(x2) ? x2 : null, "must be a plan id"),
        plan_status: optStatus()
      };
      break;
    case "edit-phase":
      op = { op: k2, id: id("id"), name: optText("name", TEXT_MAX.name), goal: optText("goal", PHASE_GOAL_MAX), plan_status: optStatus() };
      none(PHASE_FIELDS);
      break;
    case "order-phases":
      op = { op: k2, phases: order("phases") };
      break;
    case "move":
      op = { op: k2, task: id("task"), phase: id("phase") };
      break;
    case "order-tasks":
      op = { op: k2, phase: id("phase"), tasks: order("tasks") };
      break;
    case "edit": {
      const deps = optional2("depends_on", idList, "must be a list of plan ids");
      op = {
        op: k2,
        task: id("task"),
        title: optText("title", TEXT_MAX.name),
        done_when: optText("done_when", TEXT_MAX.doneWhen),
        depends_on: deps && [...new Set(deps)],
        estimate_min: optional2("estimate_min", minutes, "must be a positive number of minutes")
      };
      none(TASK_FIELDS);
      break;
    }
    case "retire":
      op = { op: k2, task: id("task"), why: required2("why", TEXT_MAX.why) };
      break;
  }
  return wrong.length ? { error: wrong.join("; "), kind: k2 } : dropUndefined(op);
}
function normalizeOps(x2) {
  if (Array.isArray(x2)) return { ops: [], errors: ['ops: the file must be { "ops": [...] }, not a bare list'] };
  const list = isObj2(x2) ? x2.ops : void 0;
  if (!Array.isArray(list)) return { ops: [], errors: ["ops: not a list"] };
  if (!list.length) return { ops: [], errors: [EMPTY] };
  if (list.length > MAX_OPS) return { ops: [], errors: [TOO_MANY(list.length)] };
  const ops = [];
  const errors = [];
  list.forEach((o, i) => {
    const r2 = readOp(o);
    if ("error" in r2) errors.push(`ops[${i}]${r2.kind ? ` ${r2.kind}` : ""}: ${r2.error}`);
    else ops.push(r2);
  });
  return { ops, errors };
}
function nodesOf(doc) {
  let alias = false;
  (0, import_yaml2.visit)(doc, { Alias: () => {
    alias = true;
    return import_yaml2.visit.BREAK;
  } });
  if (alias) throw new ReplanError(["plan: it uses an alias (*name), which a replan cannot keep in place: write the value out in plan.yaml"]);
  const maps = (s) => (0, import_yaml2.isSeq)(s) && s.items.every(import_yaml2.isMap);
  const phases = doc.get("phases", true), tasks = doc.get("tasks", true), versions = doc.get("versions", true);
  if (!maps(phases) || !maps(tasks) || versions !== void 0 && !maps(versions)) {
    throw new ReplanError(["plan: phases, tasks and versions must be lists of maps"]);
  }
  const lists = versions === void 0 ? [] : versions.items.map((v) => v.get("phases", true));
  if (!lists.every((l3) => (0, import_yaml2.isSeq)(l3) && l3.items.every(import_yaml2.isScalar))) throw new ReplanError(["plan: the phases of each version must be a list of ids"]);
  return { phases, tasks, versions: lists };
}
var idOf = (n) => (0, import_yaml2.isMap)(n) ? String(n.get("id")) : "";
var scalarOf = (n) => (0, import_yaml2.isScalar)(n) ? String(n.value) : "";
var indexOf = (seq, id) => seq.items.findIndex((n) => idOf(n) === id);
var mapOf = (seq, id) => seq.items.find((n) => idOf(n) === id) ?? null;
var depsOf = (task) => {
  const d = (0, import_yaml2.isMap)(task) ? task.get("depends_on", true) : void 0;
  return (0, import_yaml2.isSeq)(d) ? d.items.map(scalarOf) : [];
};
function notEachOnce(given, current, one, many) {
  const seen = /* @__PURE__ */ new Set();
  const twice = /* @__PURE__ */ new Set();
  for (const id of given) {
    if (seen.has(id)) twice.add(id);
    seen.add(id);
  }
  const missing = current.filter((id) => !seen.has(id));
  const extra = [...seen].filter((id) => !current.includes(id));
  const parts = [
    missing.length ? `missing ${missing.join(", ")}` : "",
    extra.length ? `${extra.join(", ")} ${extra.length === 1 ? `is not a ${one}` : `are not ${many}`}` : "",
    twice.size ? `${[...twice].join(", ")} twice` : ""
  ].filter(Boolean);
  return parts.length ? `the list must name every ${one} once: ${parts.join("; ")}` : null;
}
function applyOp(doc, n, op, retired) {
  switch (op.op) {
    case "add-phase": {
      if (indexOf(n.phases, op.id) >= 0) return { issue: `phase ${op.id} already exists` };
      let at2 = n.phases.items.length;
      if (op.after !== void 0) {
        const i = indexOf(n.phases, op.after);
        if (i < 0) return { issue: `phase ${op.after} not found` };
        at2 = i + 1;
      }
      const node2 = doc.createNode(dropUndefined({ id: op.id, name: op.name, plan_status: op.plan_status, goal: op.goal }));
      const like = n.phases.items[at2 - 1] ?? n.phases.items[at2];
      if ((0, import_yaml2.isMap)(like) && like.flow) node2.flow = true;
      n.phases.items.splice(at2, 0, node2);
      const home = op.after === void 0 ? void 0 : n.versions.find((l3) => l3.items.some((x2) => scalarOf(x2) === op.after));
      const list = home ?? n.versions.at(-1);
      if (list) list.items.splice(home ? home.items.findIndex((x2) => scalarOf(x2) === op.after) + 1 : list.items.length, 0, doc.createNode(op.id));
      return { change: `+${op.id} ${op.name}` };
    }
    case "edit-phase": {
      const node2 = mapOf(n.phases, op.id);
      if (!node2) return { issue: `phase ${op.id} not found` };
      const now = (k2) => node2.get(k2) ?? (k2 === "plan_status" ? "committed" : void 0);
      const fields = PHASE_FIELDS.filter((k2) => op[k2] !== void 0 && op[k2] !== now(k2));
      if (!fields.length) return { change: null };
      for (const k2 of fields) node2.set(k2, op[k2]);
      return { change: `${op.id}: ${fields.join(", ")}` };
    }
    case "order-phases": {
      const wrong = notEachOnce(op.phases, n.phases.items.map(idOf), "phase", "phases");
      if (wrong) return { issue: wrong };
      const shape = () => JSON.stringify([n.phases.items.map(idOf), n.versions.map((l3) => l3.items.map(scalarOf))]);
      const before = shape();
      const byId = new Map(n.phases.items.map((x2) => [idOf(x2), x2]));
      n.phases.items = op.phases.map((id) => byId.get(id));
      const rank = (x2) => op.phases.indexOf(scalarOf(x2));
      for (const l3 of n.versions) l3.items.sort((a, b) => rank(a) - rank(b));
      return { change: shape() === before ? null : `phases: ${op.phases.join(", ")}` };
    }
    case "move": {
      const node2 = mapOf(n.tasks, op.task);
      if (!node2) return { issue: `task ${op.task} not found` };
      if (indexOf(n.phases, op.phase) < 0) return { issue: `phase ${op.phase} not found` };
      const from = String(node2.get("phase"));
      if (from === op.phase) return { change: null };
      node2.set("phase", op.phase);
      return { change: `${op.task}: ${from} \u2192 ${op.phase}` };
    }
    case "order-tasks": {
      if (indexOf(n.phases, op.phase) < 0) return { issue: `phase ${op.phase} not found` };
      const slots = n.tasks.items.flatMap((x2, i) => (0, import_yaml2.isMap)(x2) && String(x2.get("phase")) === op.phase ? [i] : []);
      const byId = new Map(slots.map((i) => [idOf(n.tasks.items[i]), n.tasks.items[i]]));
      const wrong = notEachOnce(op.tasks, [...byId.keys()], `task of ${op.phase}`, `tasks of ${op.phase}`);
      if (wrong) return { issue: wrong };
      if ([...byId.keys()].join() === op.tasks.join()) return { change: null };
      op.tasks.forEach((id, k2) => {
        n.tasks.items[slots[k2]] = byId.get(id);
      });
      return { change: `${op.phase}: ${op.tasks.join(", ")}` };
    }
    case "edit": {
      const node2 = mapOf(n.tasks, op.task);
      if (!node2) return { issue: `task ${op.task} not found` };
      const sameSet = (a, b) => {
        const s = new Set(a);
        return s.size === new Set(b).size && b.every((x2) => s.has(x2));
      };
      const same = (k2) => k2 === "depends_on" ? sameSet(depsOf(node2), op.depends_on ?? []) : node2.get(k2) === op[k2];
      const fields = TASK_FIELDS.filter((k2) => op[k2] !== void 0 && !same(k2));
      if (!fields.length) return { change: null };
      for (const k2 of fields) {
        if (k2 !== "depends_on") {
          node2.set(k2, op[k2]);
          continue;
        }
        const deps = doc.createNode(op.depends_on ?? []);
        deps.flow = true;
        node2.set(k2, deps);
      }
      return { change: `${op.task}: ${fields.join(", ")}` };
    }
    case "retire": {
      const i = indexOf(n.tasks, op.task);
      if (i < 0) return { issue: `task ${op.task} not found` };
      n.tasks.items.splice(i, 1);
      retired.push(op.task);
      return { change: `\u2212${op.task} (${fitText(op.why, PLAN_HISTORY_MAX.change - op.task.length - 4)})` };
    }
  }
}
function checked(text3) {
  try {
    return parsePlan(text3);
  } catch (e) {
    if (e instanceof PlanError) throw new ReplanError(e.issues);
    throw e;
  }
}
var shapeOf = (p) => JSON.stringify({ ...p, history: void 0 });
function serialize(doc, eol) {
  let out;
  try {
    out = doc.toString({ lineWidth: 0 });
  } catch (e) {
    throw new ReplanError([`plan: yaml cannot write the result: ${e.message}`]);
  }
  return eol === "\n" ? out : out.replace(/\n/g, eol);
}
function addRetired(doc, ids) {
  const list = doc.get("retired", true);
  if (!(0, import_yaml2.isSeq)(list)) {
    const node2 = doc.createNode(ids);
    node2.flow = true;
    doc.set("retired", node2);
    return;
  }
  for (const id of ids) if (!list.items.some((x2) => scalarOf(x2) === id)) list.items.push(doc.createNode(id));
}
function entryChanges(all) {
  const max = PLAN_HISTORY_MAX.changes;
  return all.length <= max ? all : [...all.slice(0, max - 1), `\u2026 ${all.length - max + 1} more`];
}
function addHistory(doc, entry) {
  const history = doc.get("history", true);
  if (!(0, import_yaml2.isSeq)(history)) {
    doc.set("history", doc.createNode([entry]));
    return;
  }
  history.flow = false;
  doc.addIn(["history"], doc.createNode(entry));
  history.items.splice(0, Math.max(0, history.items.length - PLAN_HISTORY_MAX.entries));
}
function applyReplan(text3, ops, why, at2) {
  if (!ops.length) throw new ReplanError([EMPTY]);
  if (ops.length > MAX_OPS) throw new ReplanError([TOO_MANY(ops.length)]);
  const reason = fitText(why, PLAN_HISTORY_MAX.why);
  if (!reason) throw new ReplanError(["why: empty (the why is part of the history)"]);
  const before = checked(text3);
  const doc = (0, import_yaml2.parseDocument)(text3);
  const nodes = nodesOf(doc);
  const issues = [];
  const changes = [];
  const retired = [];
  ops.forEach((op, i) => {
    const r2 = applyOp(doc, nodes, op, retired);
    if ("issue" in r2) issues.push(`ops[${i}] ${op.op}: ${r2.issue}`);
    else if (r2.change !== null) changes.push(fitText(r2.change, PLAN_HISTORY_MAX.change));
  });
  for (const id of retired) {
    const users = nodes.tasks.items.filter((t) => depsOf(t).includes(id)).map(idOf);
    if (users.length) issues.push(`retire ${id}: ${users.join(", ")} still depend${users.length === 1 ? "s" : ""} on it`);
  }
  if (issues.length) throw new ReplanError(issues);
  if (!changes.length) return { text: text3, changes: [] };
  if (retired.length) addRetired(doc, retired);
  const eol = (text3.match(/\r\n/g) ?? []).length * 2 > (text3.match(/\n/g) ?? []).length ? "\r\n" : "\n";
  if (shapeOf(checked(serialize(doc, eol))) === shapeOf(before)) return { text: text3, changes: [] };
  addHistory(doc, { at: at2, why: reason, changes: entryChanges(changes) });
  const next = serialize(doc, eol);
  checked(next);
  return { text: next, changes };
}

// src/lib/sync.ts
var import_node_crypto = require("node:crypto");

// src/lib/waypoint-version.ts
var WAYPOINT_VERSION = true ? "0.35.1" : "0.0.0";
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
function planViewFromDocs(meta2, phases) {
  const ordered = uniquePhases(phases).sort((a, b) => a.order - b.order);
  return {
    tracks: meta2.tracks,
    versions: meta2.versions,
    phases: ordered.map(({ id, name, plan_status, goal }) => ({ id, name, plan_status, ...goal ? { goal } : {} })),
    tasks: ordered.flatMap((p) => p.tasks)
  };
}
var DEL = { __delete__: true };
function buildSyncWrites(plan, known, outDir, opts) {
  const k2 = (c) => known[c] ?? {};
  const { meta: meta2, phases } = buildDocs(plan, opts.nowIso);
  const files = {};
  const file = (name, body) => {
    const p = `${outDir.replace(/[\\/]+$/, "")}/${name}`;
    files[p] = body;
    return p;
  };
  const writes = [];
  const metaV = k2("meta").project;
  const { metrics: _keep, ...rest } = meta2;
  const metaWrite = metaV ? { op: "update", collection: "meta", doc_id: "project", file_path: file("meta.json", rest), if_version: metaV } : { op: "set", collection: "meta", doc_id: "project", file_path: file("meta.json", meta2) };
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
      data: { ts: opts.nowIso, type: "plan_changed", sessionId: opts.sessionId, text: `plan ${meta2.planHash}` }
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

// src/lib/notes.ts
var NOTE_TYPES = ["decision", "idea", "debt", "question"];
var NOTE_KINDS = [...NOTE_TYPES, "market"];
var MAX_NOTE = 2e3;
var MAX_SOURCES = 20;
var MAX_URL = 2e3;
var MAX_SOURCE_TITLE = 200;
var MAX_NAME = 80;
var SAY_MAX = 200;
var str2 = (x2) => typeof x2 === "string";
var NOTE_ID = /^[A-Za-z0-9_.:~@+-]{1,160}$/;
var clipPoints = (s, max) => s.length <= max ? s : Array.from(s).slice(0, max).join("");
function webHref(url) {
  if (!url || url.length > MAX_URL || /\s/.test(url) || clean(url, MAX_URL) !== url) return null;
  try {
    const u = new URL(url);
    return (u.protocol === "http:" || u.protocol === "https:") && !u.username && !u.password ? u.href : null;
  } catch {
    return null;
  }
}
function normalizeSources(x2) {
  if (!Array.isArray(x2)) return [];
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const s of x2) {
    if (out.length >= MAX_SOURCES) break;
    if (!s || typeof s !== "object" || Array.isArray(s)) continue;
    const o = s;
    const url = str2(o.url) ? o.url.trim() : "";
    const href = webHref(url);
    if (!href || seen.has(href)) continue;
    seen.add(href);
    out.push({ title: (str2(o.title) ? clean(o.title, MAX_SOURCE_TITLE) : "") || clean(url, MAX_SOURCE_TITLE), url });
  }
  return out;
}
function normalizeNote(x2) {
  if (!x2 || typeof x2 !== "object" || Array.isArray(x2)) return null;
  const o = x2;
  if (!str2(o.type) || !NOTE_KINDS.includes(o.type)) return null;
  if (!str2(o.author) || !str2(o.text)) return null;
  const out = { ts: str2(o.ts) ? o.ts : "", type: o.type, author: o.author, text: clipPoints(o.text, MAX_NOTE) };
  if (str2(o.taskId)) out.taskId = o.taskId;
  if (str2(o.answer)) out.answer = clipPoints(o.answer, MAX_NOTE);
  if (str2(o.answeredBy)) out.answeredBy = o.answeredBy;
  if (str2(o.answeredAt)) out.answeredAt = o.answeredAt;
  if (str2(o.answeredByNote) && NOTE_ID.test(o.answeredByNote)) out.answeredByNote = o.answeredByNote;
  if (str2(o.authorName) && o.authorName.trim()) out.authorName = clean(o.authorName, MAX_NAME);
  if (str2(o.answeredByName) && o.answeredByName.trim()) out.answeredByName = clean(o.answeredByName, MAX_NAME);
  if (str2(o.proposalId) && o.proposalId && !o.proposalId.includes("/")) out.proposalId = o.proposalId;
  const decision = normalizeNoteDecision(o.decision);
  if (decision) out.decision = decision;
  const sources = out.type === "market" ? normalizeSources(o.sources) : [];
  if (sources.length) out.sources = sources;
  return out;
}
function normalizeNoteDecision(x2) {
  if (!x2 || typeof x2 !== "object" || Array.isArray(x2)) return null;
  const o = x2;
  if (!str2(o.point) || !DECISION_POINTS.includes(o.point)) return null;
  const line3 = (v, max) => str2(v) ? clean(v, max) : "";
  const what = line3(o.what, LIMITS.what);
  const chosen = line3(o.chosen, LIMITS.chosen);
  const why = line3(o.why, LIMITS.why);
  if (!what || !chosen || !why) return null;
  const out = { point: o.point, what, chosen, why, auto: o.auto === true };
  const alternatives = Array.isArray(o.alternatives) ? o.alternatives.map(normalizeAlternative).filter((a) => a !== null).slice(0, LIMITS.alternatives) : [];
  if (alternatives.length) out.alternatives = alternatives;
  const tradeoffs = line3(o.tradeoffs, LIMITS.tradeoffs);
  if (tradeoffs) out.tradeoffs = tradeoffs;
  const revert = line3(o.revert, LIMITS.revert);
  if (revert) out.revert = revert;
  return out;
}
var time2 = (s) => {
  const t = s ? Date.parse(s) : NaN;
  return Number.isNaN(t) ? -Infinity : t;
};
function notesSince(notes, since) {
  const s = since ? Date.parse(since) : NaN;
  const valid = !Number.isNaN(s);
  const kept = notes.filter((n) => {
    if (!valid) return n.author.startsWith("user:");
    if (n.author.startsWith("user:") && time2(n.ts) > s) return true;
    return n.type === "question" && !!n.answer && time2(n.answeredAt) > s;
  });
  const key = (n) => Math.max(time2(n.ts), time2(n.answeredAt));
  return kept.map((n, i) => ({ n, i })).sort((a, b) => {
    const ta = key(a.n);
    const tb = key(b.n);
    if (ta === tb) return a.i - b.i;
    return ta > tb ? 1 : -1;
  }).map((x2) => x2.n);
}
var SAY = {
  es: {
    note: (who, text3) => `Nota de ${who ?? "una persona"} en el roadmap: \xAB${text3}\xBB`,
    answer: (who, text3) => `Respuesta de ${who ?? "una persona"} en el roadmap: \xAB${text3}\xBB`
  },
  en: {
    note: (who, text3) => `${who ? `${who}'s` : "Someone's"} note on the roadmap: "${text3}"`,
    answer: (who, text3) => `${who ? `${who}'s` : "Someone's"} answer on the roadmap: "${text3}"`
  }
};
function sayText(s) {
  const chars = Array.from(s.replace(/\s+/g, " ").trim());
  return chars.length <= SAY_MAX ? chars.join("") : chars.slice(0, SAY_MAX - 1).join("") + "\u2026";
}
function noteLines(notes, since, locale, taskIds) {
  const s = since ? Date.parse(since) : NaN;
  const fresh = (ts) => Number.isNaN(s) || time2(ts) > s;
  const say = [];
  const mentions = [];
  const add = (line3, text3) => {
    say.push(line3);
    mentions.push([...new Set([...text3.matchAll(/\bT\d{3,}\b/g)].map((m) => m[0]))].filter((id) => taskIds.has(id)));
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
  const status2 = statusOf(states, task.id);
  if (status2 === "free") return true;
  if (status2 !== "blocked") return false;
  const by = st2?.blockedBy ?? [];
  return by.length > 0 && !by.includes("external") && by.every((b) => statusOf(states, b) === "done");
}
function availableTasks(plan, states, opts = {}) {
  const order = new Map(plan.phases.map((p, i) => [p.id, i]));
  return plan.tasks.map((t, i) => ({ t, i })).filter(({ t }) => isAvailable(t, states) && isUnlocked(t, states) && (!opts.track || t.track === opts.track)).sort((a, b) => order.get(a.t.phase) - order.get(b.t.phase) || a.i - b.i).map((x2) => x2.t);
}
function nextTask(plan, states, opts) {
  const own2 = plan.tasks.find((t) => states[t.id]?.owner === opts.sessionId && ["claimed", "in_progress"].includes(statusOf(states, t.id)));
  if (own2) return { task: own2, resumed: true };
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
  const own2 = nextTask(plan, states, opts);
  if (own2.resumed && own2.task) {
    return { task: own2.task, resumed: true, unblock: false, conflicts: conflicts(own2.task.id) };
  }
  const open2 = availableTasks(plan, states, opts).filter((t) => {
    const owner = states[t.id]?.owner;
    return !owner || owner === opts.sessionId;
  });
  const waiting = [];
  if (opts.integrated) {
    for (const t of open2) {
      const dep = notIntegratedDep(plan, states, t, opts.integrated);
      if (dep) waiting.push({ taskId: t.id, dependsOn: dep });
    }
  }
  const candidates = open2.filter((t) => !waiting.some((w) => w.taskId === t.id));
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
function isIdle(s, now, minutes2 = IDLE_MINUTES) {
  return !s || s.status === "idle" || liveness(now, leaseOf(s, Math.max(0, minutes2 - SILENT_MINUTES))) === "stopped";
}
function liveness(now, leaseUntil) {
  const until = typeof leaseUntil === "number" ? leaseUntil : typeof leaseUntil === "string" ? Date.parse(leaseUntil) : NaN;
  if (!Number.isFinite(until)) return "stopped";
  if (now < until) return "alive";
  return now - until < SILENT_MINUTES * 6e4 ? "silent" : "stopped";
}
function recoverableTasks(plan, states, sessions, now, minutes2 = IDLE_MINUTES) {
  return plan.tasks.filter((t) => ACTIVE.includes(statusOf(states, t.id)) && states[t.id]?.owner && isIdle(sessions[states[t.id].owner], now, minutes2)).map((t) => ({ taskId: t.id, owner: states[t.id].owner }));
}
function inboxFor(messages, sessionId) {
  return Object.entries(messages).filter((e) => !!e[1]).filter(([, m]) => m.status === "open" && m.from !== sessionId && (m.to === sessionId || m.to === "*")).map(([id, m]) => ({ ...m, id })).sort((a, b) => {
    const ta = String(a.ts ?? ""), tb = String(b.ts ?? "");
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });
}
function multiSession(i) {
  if (i.inTrackWorktree) return true;
  if (i.messages && inboxFor(i.messages, i.sid).some((m) => m.to === i.sid)) return true;
  return !!i.sessions && Object.entries(i.sessions).some(([id, s]) => id !== i.sid && !isIdle(s, i.now));
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
    const open2 = list.filter((m) => m.status === "open");
    if (open2.length < 4) continue;
    const [a, b] = [String(list[0].from), String(list[0].to)].sort();
    out.push({ key, taskId: list[0].taskId ?? "", sessions: [a, b], count: open2.length });
  }
  return out;
}

// src/lib/one-line.ts
var BIDI = new RegExp(`[${[1564, 8206, 8207, 8234, 8235, 8236, 8237, 8238, 8294, 8295, 8296, 8297].map((c) => String.fromCharCode(c)).join("")}]`, "g");
var CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
var oneLine = (text3) => String(text3).replace(CONTROL, " ").replace(BIDI, "").replace(/\s+/g, " ").trim();

// src/lib/batches.ts
var REASON_MAX = 300;
var SUMMARY_MAX = 300;
var DEL2 = { __delete__: true };
var MIN = 6e4;
var iso = (ms) => new Date(ms).toISOString();
var clipPoints2 = (text3, max) => text3.length <= max ? text3 : Array.from(text3).slice(0, max).join("");
function cleanText(text3, max) {
  return clipPoints2(oneLine(text3), max);
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
var TEXT_MAX2 = 200;
var NAME_MAX = 80;
var REVIEWER_MAX = 40;
var REVIEWERS_MAX = 6;
var COUNT_MAX = 999;
var DOC_PATHS = ["trivial", "small", "medium", "large"];
var DOC_STAGES = [...STAGES, "triage", "done", "blocked", "stopped"];
var ACTIONS = ["accept", "fix", "redo"];
var STAGE_KEYS = [...STAGES, "triage"];
var isObj3 = (x2) => typeof x2 === "object" && x2 !== null && !Array.isArray(x2);
var kindOf = (v) => v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
var int2 = (v, min, max) => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
var iso2 = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v));
var isAction = (v) => ACTIONS.includes(v);
var BIDI2 = new RegExp(`[${[1564, 8206, 8207, 8234, 8235, 8236, 8237, 8238, 8294, 8295, 8296, 8297].map((c) => String.fromCharCode(c)).join("")}]`, "g");
var CONTROL2 = /[\u0000-\u001f\u007f-\u009f]/g;
var clip = (v, max) => v.length <= max ? v : Array.from(v).slice(0, max).join("");
var line = (v, max) => clip(v.replace(CONTROL2, " ").replace(BIDI2, "").trim(), max);
function validatorOf(v) {
  if (!isObj3(v) || typeof v.name !== "string" || !v.name.trim() || typeof v.ok !== "boolean") return null;
  const out = { name: line(v.name, NAME_MAX), ok: v.ok };
  if (v.flaky === true) out.flaky = true;
  if (typeof v.skipped === "string" && v.skipped.trim()) out.skipped = line(v.skipped, NAME_MAX);
  if (v.preexisting === true) out.preexisting = true;
  if (int2(v.ms, 0, 864e5)) out.ms = v.ms;
  if (v.cached === true) out.cached = true;
  if (int2(v.failing, 0, 1e5)) out.failing = v.failing;
  return out;
}
function roundOf(r2) {
  if (!isObj3(r2) || !int2(r2.brief, 1, 9999) || !int2(r2.n, 1, 99) || !isAction(r2.action) || typeof r2.note !== "string" || !iso2(r2.at)) return null;
  const f = isObj3(r2.findings) ? r2.findings : {};
  const c = (k2) => int2(f[k2], 0, COUNT_MAX) ? f[k2] : null;
  const findings = { critical: c("critical"), important: c("important"), minor: c("minor"), deferred: c("deferred") };
  if (Object.values(findings).some((x2) => x2 === null)) return null;
  const reviewers = (Array.isArray(r2.reviewers) ? r2.reviewers : []).filter((x2) => typeof x2 === "string" && !!x2.trim()).map((x2) => line(x2, REVIEWER_MAX)).slice(0, REVIEWERS_MAX);
  return { brief: r2.brief, n: r2.n, action: r2.action, note: line(r2.note, NOTE_MAX), findings, reviewers, at: r2.at };
}
function deferredOf(d) {
  if (!isObj3(d) || typeof d.problem !== "string" || !d.problem.trim()) return null;
  const out = { problem: line(d.problem, PROBLEM_MAX) };
  if (typeof d.file === "string" && d.file.trim()) out.file = line(d.file, TEXT_MAX2);
  if (int2(d.line, 1, 1e7)) out.line = d.line;
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
    passed: int2(v.passed, 0, 1e3) ? v.passed : null,
    total: int2(v.total, 0, 1e3) ? v.total : null,
    skipped: typeof v.skipped === "string" && v.skipped.trim() ? line(v.skipped, TEXT_MAX2) : null,
    surfaces: (Array.isArray(v.surfaces) ? v.surfaces : []).filter((s) => typeof s === "string" && !!s.trim()).map((s) => line(s, NAME_MAX)).slice(0, 10)
  };
}
var SHA = /^[0-9a-f]{7,40}$/i;
function integrationOf(v, report) {
  if (typeof v.branch !== "string" || !v.branch.trim() || typeof v.target !== "string" || !v.target.trim() || typeof v.merged !== "boolean") {
    report?.("forge.integration", "coerced", "branch, target or merged");
    return null;
  }
  return { branch: line(v.branch, TEXT_MAX2), sha: typeof v.sha === "string" && SHA.test(v.sha) ? v.sha : null, merged: v.merged, target: line(v.target, TEXT_MAX2) };
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
  if (!isObj3(x2)) return bad(kindOf(x2));
  if (x2.v !== 2) return bad("no v: 2");
  if (!DOC_PATHS.includes(x2.path)) return bad("path");
  if (!DOC_STAGES.includes(x2.stage)) return bad("stage");
  if (typeof x2.phase !== "string") return bad("phase");
  if (!int2(x2.brief, 1, 9999)) return bad("brief");
  if (!Array.isArray(x2.rounds) || !Array.isArray(x2.validators) || !Array.isArray(x2.deferred) || !isObj3(x2.stages)) return bad("rounds, validators, deferred or stages");
  if (x2.verify !== null && !isObj3(x2.verify)) return bad("verify");
  if (x2.integration !== null && !isObj3(x2.integration)) return bad("integration");
  if (x2.acceptedRound !== null && !int2(x2.acceptedRound, 1, 99)) return bad("acceptedRound");
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
  if (isObj3(x2.verdict) && isAction(x2.verdict.action)) {
    doc.verdict = { action: x2.verdict.action, score: typeof x2.verdict.score === "number" && Number.isFinite(x2.verdict.score) ? x2.verdict.score : null };
    if (doc.verdict.score === null && x2.verdict.score !== null) coerced("verdict", x2.verdict.score);
  } else if (x2.verdict !== void 0) coerced("verdict", x2.verdict);
  if (int2(x2.round, 1, 99)) doc.round = x2.round;
  else if (x2.round !== void 0) coerced("round", x2.round);
  if (int2(x2.cap, 1, 99)) doc.cap = x2.cap;
  else if (x2.cap !== void 0) coerced("cap", x2.cap);
  if (doc.round !== void 0 && doc.cap !== void 0 && doc.round > doc.cap) doc.overCap = true;
  return doc;
}

// src/lib/forge-run.ts
var SATURATION_BLOCKING = ["rounds", "pending-tasks", "validators", "findings", "defects", "proposals", "inputs"];
var SATURATION_LISTS = [
  "pendingTasks",
  "validatorsFailed",
  "openDefects",
  "openProposals",
  "parked",
  "waitsOwner",
  "unowned",
  "blockedTasks",
  "unplaced",
  "orphanFindings"
];
var SATURATION_LIST_MAX = 20;
var SATURATION_INPUTS = ["--plan", "--db", "--validate"];
var PROFILES = ["spike", "product"];
var AUTONOMOUS_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
var MAX_AUTONOMOUS_NAME = 40;
var isAutonomousName = (x2) => typeof x2 === "string" && x2.length <= MAX_AUTONOMOUS_NAME && AUTONOMOUS_NAME.test(x2);
var isBranchName = (x2) => typeof x2 === "string" && x2 !== "" && !x2.includes("..") && !x2.startsWith("-") && !/[\s\u0000-\u001f\u007f]/.test(x2);
var isAbsolutePath = (x2) => typeof x2 === "string" && /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(x2);
function autonomousOf(x2) {
  if (!x2 || typeof x2 !== "object" || Array.isArray(x2)) return null;
  const a = x2;
  if (!PROFILES.includes(a.profile)) return null;
  const profile = a.profile;
  if (!isAutonomousName(a.name)) return null;
  const runId = `${profile}-${a.name}`;
  if (a.runId !== runId || a.branch !== `forge/${runId}` || !isAbsolutePath(a.worktree) || !isBranchName(a.startBranch)) return null;
  const pb = a.protectedBranches;
  if (!Array.isArray(pb) || pb.length < 1 || pb.length > 10 || !pb.every(isBranchName)) return null;
  return { profile, name: a.name, runId, worktree: a.worktree, branch: a.branch, startBranch: a.startBranch, protectedBranches: [...pb] };
}
var LOCALE = /^[a-z]{2,3}([-_][A-Za-z0-9]{2,8})?$/;
var isLocale = (x2) => typeof x2 === "string" && LOCALE.test(x2);
var isCount = (x2) => typeof x2 === "number" && Number.isInteger(x2) && x2 >= 0;
var isPositiveInt = (x2) => isCount(x2) && x2 > 0;
var isPositive = (x2) => typeof x2 === "number" && Number.isFinite(x2) && x2 > 0;
var isObj4 = (x2) => !!x2 && typeof x2 === "object" && !Array.isArray(x2);
function exploreOf(x2) {
  if (!isObj4(x2) || !isCount(x2.rounds) || !isCount(x2.dry) || x2.dry > x2.rounds) return null;
  return { rounds: x2.rounds, dry: x2.dry };
}
var cp2 = (n) => String.fromCharCode(n);
var REPORT_ID = new RegExp(`^[^${cp2(0)}-${cp2(31)}${cp2(127)}-${cp2(159)}${cp2(8234)}-${cp2(8238)}${cp2(8294)}-${cp2(8297)}]{1,80}$`, "u");
var idList2 = (x2) => Array.isArray(x2) && x2.length <= SATURATION_LIST_MAX && x2.every((v) => typeof v === "string" && REPORT_ID.test(v));
var oneOf = (list, x2) => typeof x2 === "string" && list.includes(x2);
function saturationReportOf(x2) {
  if (!isObj4(x2)) return null;
  const { saturated, at: at2, rounds, explored, blocking, evidence: e, waiting: w, counts: c, missing } = x2;
  if (typeof saturated !== "boolean" || typeof at2 !== "string" || !at2 || at2.length > 64 || !isCount(rounds)) return null;
  if (explored !== void 0 && (typeof explored !== "boolean" || saturated && !explored)) return null;
  if (!Array.isArray(blocking) || !blocking.every((b) => oneOf(SATURATION_BLOCKING, b)) || new Set(blocking).size !== blocking.length) return null;
  if (saturated !== (blocking.length === 0) || !isObj4(e) || !isObj4(w) || !isObj4(c)) return null;
  if (!isCount(e.openFindings) || !isCount(w.questions) || !isCount(w.blocked) || !isCount(w.deferred)) return null;
  const lists = {
    pendingTasks: e.pendingTasks,
    validatorsFailed: e.validatorsFailed,
    openDefects: e.openDefects,
    openProposals: e.openProposals,
    parked: w.parked,
    waitsOwner: w.waitsOwner,
    unowned: w.unowned,
    blockedTasks: w.blockedTasks,
    unplaced: w.unplaced,
    orphanFindings: w.orphanFindings
  };
  const counts = {};
  for (const k2 of SATURATION_LISTS) {
    const list = lists[k2];
    const n = c[k2];
    if (!idList2(list) || !isCount(n) || n < list.length) return null;
    counts[k2] = n;
  }
  if (missing !== void 0 && !(Array.isArray(missing) && missing.length && missing.every((m) => oneOf(SATURATION_INPUTS, m)))) return null;
  if (blocking.includes("inputs") !== (missing !== void 0)) return null;
  const ids = (k2) => [...lists[k2]];
  return {
    saturated,
    at: at2,
    rounds,
    ...typeof explored === "boolean" ? { explored } : {},
    blocking: [...blocking],
    evidence: { pendingTasks: ids("pendingTasks"), validatorsFailed: ids("validatorsFailed"), openFindings: e.openFindings, openDefects: ids("openDefects"), openProposals: ids("openProposals") },
    waiting: {
      parked: ids("parked"),
      questions: w.questions,
      blocked: w.blocked,
      deferred: w.deferred,
      waitsOwner: ids("waitsOwner"),
      unowned: ids("unowned"),
      blockedTasks: ids("blockedTasks"),
      unplaced: ids("unplaced"),
      orphanFindings: ids("orphanFindings")
    },
    counts,
    ...missing !== void 0 ? { missing: [...missing] } : {}
  };
}
function parseRun(text3) {
  if (text3 === null) return null;
  let o;
  try {
    const x2 = JSON.parse(text3);
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
  const autonomous = o.autonomous === void 0 ? void 0 : autonomousOf(o.autonomous);
  if (autonomous === null) return null;
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
  if (typeof o.lastErrorDigest === "string" && /^[0-9a-f]{64}$/.test(o.lastErrorDigest)) run2.lastErrorDigest = o.lastErrorDigest;
  if (isLocale(o.locale)) run2.locale = o.locale;
  if (autonomous) run2.autonomous = autonomous;
  const explore = exploreOf(o.explore);
  if (explore) run2.explore = explore;
  if (o.saturation === null) run2.saturation = null;
  else {
    const saturation = saturationReportOf(o.saturation);
    if (saturation) run2.saturation = saturation;
  }
  return run2;
}

// src/page/normalize.ts
var isObj5 = (x2) => typeof x2 === "object" && x2 !== null && !Array.isArray(x2);
var str3 = (v) => String(v ?? "");
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
  if (!isObj5(x2)) return {};
  const links = {};
  if (typeof x2.design === "string" && x2.design.startsWith("https://") && x2.design.length <= LINK_MAX && !NOT_IN_URL.test(x2.design)) links.design = x2.design;
  if (typeof x2.designVersion === "number" && Number.isInteger(x2.designVersion) && x2.designVersion > 0) links.designVersion = x2.designVersion;
  return Object.keys(links).length ? { links } : {};
}
function normalizeMeta(x2, report) {
  if (!isObj5(x2)) return null;
  const mt2 = isObj5(x2.metrics) ? x2.metrics : {};
  const metrics = { ...mt2 };
  const lc = mt2.lastCommit;
  if (isObj5(lc) && typeof lc.sha === "string" && typeof lc.ts === "string") metrics.lastCommit = { sha: lc.sha, ts: lc.ts };
  else {
    delete metrics.lastCommit;
    if (lc !== void 0) report?.("metrics.lastCommit", "dropped", kindOf2(lc));
  }
  return {
    name: str3(x2.name),
    locale: str3(x2.locale),
    version: str3(x2.version),
    planHash: str3(x2.planHash),
    tracks: keepAll(arr(x2.tracks), (t) => isObj5(t) && typeof t.id === "string" && typeof t.name === "string", "tracks", report),
    // G-25: a version's target is a date; any other value is dropped (and reported).
    versions: arr(x2.versions).filter(isObj5).map((v, i) => {
      if (v.target === void 0 || typeof v.target === "string" && realDate(v.target)) return v;
      report?.(`versions[${i}].target`, "dropped", kindOf2(v.target));
      const { target: _t, ...rest } = v;
      return rest;
    }),
    phaseOrder: arr(x2.phaseOrder),
    metrics,
    syncedAt: str3(x2.syncedAt),
    ...linksOf(x2.links),
    // Carry 9: x.y.z and nothing after it.
    ...typeof x2.waypointVersion === "string" && /^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(x2.waypointVersion) ? { waypointVersion: x2.waypointVersion } : {}
  };
}
function normalizeTask(t) {
  return { ...t, id: t.id, title: t.title, depends_on: strs(t.depends_on), zones: strs(t.zones), done_when: typeof t.done_when === "string" ? t.done_when : "", track: str3(t.track), phase: str3(t.phase) };
}
function normalizePhase(x2, report) {
  if (!isObj5(x2) || typeof x2.id !== "string") return null;
  const out = {
    ...x2,
    id: x2.id,
    name: str3(x2.name),
    order: typeof x2.order === "number" && Number.isFinite(x2.order) ? x2.order : 0,
    // The plan's own default (plan.ts: committed); any other value would reach a class name in the views.
    plan_status: x2.plan_status === "provisional" ? "provisional" : "committed",
    tasks: keepAll(arr(x2.tasks), (t) => isObj5(t) && typeof t.id === "string" && typeof t.title === "string", "tasks", report).map(normalizeTask)
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
  const o = isObj5(x2) ? x2 : {};
  const s = { ...o };
  s.commits = keepAll(arr(o.commits), (c) => isObj5(c) && typeof c.sha === "string" && typeof c.title === "string", "commits", report);
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
  if (!isObj5(x2)) return drop(kindOf2(x2));
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
  if (isObj5(x2) && x2.v === 2) {
    const v2 = parseForgeDocV2(x2, report);
    if (v2) return v2;
  }
  return normalizeForgeV1(x2, report);
}
function normalizeForgeV1(x2, report) {
  if (x2 === void 0) return void 0;
  if (!isObj5(x2) || typeof x2.path !== "string" || typeof x2.phase !== "string") {
    report?.("forge", "dropped", isObj5(x2) ? "no path or phase" : kindOf2(x2));
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
      } else if (isObj5(v) && typeof v.name === "string" && (typeof v.ok === "boolean" || v.ok === null)) vals.push({ name: v.name, ok: v.ok });
      else report?.(`forge.validators[${i}]`, "dropped", kindOf2(v));
    });
    f.validators = vals;
  }
  if (isObj5(x2.verdict) && typeof x2.verdict.action === "string") f.verdict = { action: x2.verdict.action, score: finite(x2.verdict.score) ? x2.verdict.score : null };
  if (finite(x2.round)) f.round = x2.round;
  if (finite(x2.cap)) f.cap = x2.cap;
  return f;
}
function normalizeSession(x2, report) {
  const o = isObj5(x2) ? x2 : {};
  let runId;
  if (safeId(o.runId)) runId = o.runId;
  else if (o.runId != null) report?.("runId", "dropped", typeof o.runId === "string" ? "not a run id" : kindOf2(o.runId));
  return {
    ...o,
    name: str3(o.name),
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
var stateDoc = (x2) => isObj5(x2) ? normalizeState(x2) : null;
var sessionDoc = (x2) => isObj5(x2) ? normalizeSession(x2) : null;
function normalizeMessage(x2) {
  if (!isObj5(x2)) return null;
  return {
    ts: str3(x2.ts),
    from: str3(x2.from),
    to: str3(x2.to),
    type: str3(x2.type),
    taskId: optStr(x2.taskId),
    text: str3(x2.text),
    status: x2.status === "resolved" ? "resolved" : "open",
    replyTo: optStr(x2.replyTo)
  };
}
var SAFE_ID = /^[A-Za-z0-9_\-.]{1,120}$/;
var safeId = (v) => typeof v === "string" && SAFE_ID.test(v) && v !== "." && v !== "..";
var safeUrl = (u) => typeof u === "string" && (u.startsWith("https://claude.ai/") || /^\/_blob\/[\w-]+$/.test(u)) ? u : void 0;
function normalizeEvidence(x2, report) {
  if (x2 === void 0) return void 0;
  if (!isObj5(x2) || x2.result !== "pass" && x2.result !== "fail" && x2.result !== "blocked") {
    report?.("evidence", "dropped", isObj5(x2) ? `result ${String(x2.result).slice(0, 20)}` : kindOf2(x2));
    return void 0;
  }
  const e = {
    surfaces: strs(x2.surfaces),
    result: x2.result,
    passed: finite(x2.passed) ? x2.passed : 0,
    total: finite(x2.total) ? x2.total : 0,
    shots: arr(x2.shots).flatMap((v, i) => {
      if (!isObj5(v) || typeof v.ok !== "boolean") {
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
      const shot = { surface: str3(v.surface), check, ok: v.ok };
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
var import_yaml3 = __toESM(require_dist(), 1);
var ID = /^[A-Za-z0-9_.-]{1,64}$/;
var DESIGN_STATUSES = ["draft", "approved", "parked"];
function designSchemas() {
  const MetaSchema = object({
    title: string2().min(1),
    project: string2().regex(ID, "invalid id (allowed: letters, digits, _ . -; max 64)").refine((s) => s !== "." && s !== "..", "invalid id"),
    locale: string2().min(1).default("en"),
    summary: string2().min(1),
    pillars: array(object({ title: string2().min(1), text: string2().min(1) })).max(8).default([]),
    start_prompt: string2().min(1).default("/waypoint:work <track>"),
    status: _enum(DESIGN_STATUSES).default("draft"),
    artifact: string2().url().optional(),
    source: string2().min(1).max(300).optional()
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
function frontMatterOf(text3) {
  return FM.exec(text3.startsWith(BOM) ? text3.slice(1) : text3);
}
function parseDesign(text3) {
  const m = frontMatterOf(text3);
  if (!m) throw new DesignError(["missing front matter block (--- ... ---) at the top of design.md"]);
  let raw;
  try {
    raw = (0, import_yaml3.parse)(m[1] ?? "");
  } catch (e) {
    throw new DesignError([`YAML: ${e.message}`]);
  }
  const r2 = schemas2().MetaSchema.safeParse(raw ?? {});
  if (!r2.success) throw new DesignError(r2.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`));
  const body = m[2];
  return { meta: r2.data, body, sections: sectionsOf(body), words: wordCount(body) };
}
function setDesignStatus(text3, status2) {
  const bom = text3.startsWith(BOM) ? BOM : "";
  const rest = bom ? text3.slice(1) : text3;
  const m = /^(---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/.exec(rest);
  if (!m) throw new DesignError(["missing front matter block (--- ... ---) at the top of design.md"]);
  const eol = m[1].endsWith("\r\n") ? "\r\n" : "\n";
  const lines2 = m[2].split(/\r?\n/);
  const at2 = lines2.findIndex((l3) => /^status\s*:/.test(l3));
  if (at2 >= 0) lines2[at2] = `status: ${status2}`;
  else lines2.push(`status: ${status2}`);
  return `${bom}${m[1]}${lines2.join(eol)}${m[3]}${rest.slice(m[0].length)}`;
}
var SLUG_MAX = 80;
var cutSlug = (slug, max) => slug.slice(0, max).replace(/-+$/, "");
function designBody(text3) {
  const t = text3.startsWith(BOM) ? text3.slice(1) : text3;
  const m = FM.exec(t);
  return m ? m[2] : t;
}
function designStatus(text3) {
  const m = FM.exec(text3.startsWith(BOM) ? text3.slice(1) : text3);
  if (!m) return null;
  try {
    const raw = (0, import_yaml3.parse)(m[1] ?? "");
    const status2 = raw && typeof raw === "object" ? raw.status : void 0;
    return typeof status2 === "string" ? status2 : null;
  } catch {
    return null;
  }
}
function slugify2(heading) {
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
  let text3 = line3.slice(level).trim();
  let end = text3.length;
  while (end > 0 && text3.charCodeAt(end - 1) === 35) end--;
  if (end > 0 && end < text3.length && /\s/.test(text3.charAt(end - 1))) text3 = text3.slice(0, end).trimEnd();
  return text3 && !LINE_BREAK.test(text3) ? { level, text: text3 } : null;
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
      const open2 = /^\s*(`{3,}|~{3,})/.exec(line3);
      if (open2) fence = open2[1];
    }
    if (isHeading) {
      flush();
      const base = slugify2(isHeading.text);
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
  for (const [slug, text3] of after) {
    const old = before.get(slug);
    if (slug === "_intro" ? (old ?? "") !== text3 : old !== text3) changed.push(slug);
  }
  const kept = new Set(n.sections.map((s) => s.slug));
  return { changed, removed: p.sections.map((s) => s.slug).filter((s) => !kept.has(s)) };
}

// src/lib/design-import.ts
var import_yaml4 = __toESM(require_dist(), 1);
var SpecImportError = class extends Error {
};
var SUMMARY_MAX2 = 400;
var BOM2 = String.fromCharCode(65279);
var PURPOSE = /prop[oó]sito|purpose|overview|resumen|summary|objetivo|goal/i;
function linesOf(text3) {
  const out = [];
  let fence = null;
  for (const piece of text3.split(/(?<=\n)/)) {
    const t = piece.replace(/\r?\n$/, "");
    if (fence) {
      out.push({ text: t, fenced: true });
      const close = /^\s*(`{3,}|~{3,})\s*$/.exec(t);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null;
      continue;
    }
    const open2 = /^\s*(`{3,}|~{3,})/.exec(t);
    if (open2) fence = open2[1];
    out.push({ text: t, fenced: !!open2 });
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
function importSpec(text3, opts) {
  const src = text3.startsWith(BOM2) ? text3.slice(1) : text3;
  const lines2 = linesOf(src);
  const h1 = lines2.findIndex((l3) => !l3.fenced && /^#\s+\S/.test(l3.text));
  if (h1 < 0) throw new SpecImportError('the spec has no "# " title');
  const after = lines2.slice(h1 + 1);
  if (!after.some((l3) => l3.text.trim())) throw new SpecImportError('the spec has nothing after its "# " title');
  const sectioned = after.some((l3) => !l3.fenced && /^##\s+\S/.test(l3.text));
  const title = specTitle(lines2[h1].text.replace(/^#\s+/, "").replace(/\s+#*\s*$/, ""));
  let summary = null;
  for (let i = 0; i < after.length && summary === null; i++) {
    const m = after[i].fenced ? null : /^#{2,3}\s+(.+)$/.exec(after[i].text);
    if (!m || !PURPOSE.test(m[1])) continue;
    const next = after.findIndex((x2, j2) => j2 > i && !x2.fenced && /^#{2,3}\s/.test(x2.text));
    summary = firstParagraph(after.slice(i + 1, next < 0 ? after.length : next));
  }
  summary ??= firstParagraph(after) ?? title;
  const meta2 = { title, project: opts.project, locale: opts.locale, summary, pillars: [], start_prompt: "/waypoint:work <track>", status: "draft", source: opts.source };
  const pieces = src.split(/(?<=\n)/);
  const rest = pieces.slice(h1 + 1).join("").replace(/^(?:[ \t]*\r?\n)+/, "");
  const eol = /\r?\n$/.exec(pieces[h1])?.[0] ?? "\n";
  const body = sectioned ? rest : `## ${title}${eol}${eol}${rest}`;
  return `---
${(0, import_yaml4.stringify)(meta2, { lineWidth: 0 })}---

${body}`;
}

// src/lib/design-comments.ts
var THREAD_ID = /^[\x21-\x2b\x2d-\x7e]{1,200}$/;
var COMMENTS_MAX_BYTES = 256 * 1024;
var posIntOrNull = (v) => v === null ? null : typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : void 0;
function parseCommentsSeen(text3) {
  let raw;
  try {
    raw = JSON.parse(text3);
  } catch {
    return {};
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const entries2 = [];
  for (const [id, v] of Object.entries(raw)) {
    if (!THREAD_ID.test(id) || !v || typeof v !== "object" || Array.isArray(v)) continue;
    const round = posIntOrNull(v.round);
    const taken = posIntOrNull(v.taken);
    if (round === void 0 || taken === void 0) continue;
    entries2.push([id, { round, taken }]);
  }
  return Object.fromEntries(entries2);
}
function threadIds(value) {
  const ids = value.split(",").map((s) => s.trim()).filter(Boolean);
  if (!ids.length || ids.some((id) => !THREAD_ID.test(id))) return null;
  return ids;
}
var withEntries = (s, add) => Object.fromEntries([...Object.entries(s), ...add]);
function markSeen(s, ids, round) {
  const add = [];
  for (const id of ids) {
    const cur = Object.hasOwn(s, id) ? s[id] : void 0;
    add.push([id, { round: cur?.round ?? round, taken: cur?.taken ?? null }]);
  }
  return withEntries(s, add);
}
function markTaken(s, ids, version2) {
  const add = [];
  for (const id of ids) {
    const cur = Object.hasOwn(s, id) ? s[id] : void 0;
    add.push([id, { round: cur?.round ?? null, taken: version2 }]);
  }
  return withEntries(s, add);
}
function unseenOf(s, ids) {
  return ids.filter((id) => !Object.hasOwn(s, id) || s[id].round === null);
}

// src/lib/critique.ts
var ROUND_MAX = 999999;
var CRITIQUE_FILE = /^r([1-9]\d{0,5})\.json$/;
var LEGACY_CRITIQUE_FILE = /^critique-r([1-9]\d{0,5})\.json$/;
var CATEGORIES = ["scope", "done_criteria", "risk", "contradiction", "gap"];
var SEVERITIES = ["critical", "major", "minor"];
var VERDICTS = ["ready", "changes"];
function critiqueSchemas() {
  const ProposalSchema = object({
    n: number2().int().positive(),
    category: _enum(CATEGORIES),
    severity: _enum(SEVERITIES),
    section: string2().min(1),
    problem: string2().min(1),
    change: string2().min(1),
    // w7 A2: the ids of the person's comment threads this proposal takes up; absent in the critiques written before it.
    threads: array(string2().regex(THREAD_ID)).max(20).optional()
  });
  const CritiqueSchema = object({
    round: number2().int().positive(),
    version: number2().int().positive(),
    scope: _enum(["full", "changed"]),
    // K3-04: optional, so the critiques written before it still read; parseCritique fills it in.
    verdict: _enum(VERDICTS).optional(),
    proposals: array(ProposalSchema)
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
function parseCritique(text3) {
  let raw;
  try {
    raw = JSON.parse(text3);
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
  const num = custom((v) => typeof v === "number" && !Number.isNaN(v), "expected a number");
  const EntrySchema = object({
    version: num,
    date: string2(),
    note: string2(),
    words: num,
    round: num
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
function parseChangelog(text3) {
  if (!text3 || !text3.trim()) return [];
  let raw;
  try {
    raw = JSON.parse(text3);
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
function parseDismissed(text3) {
  if (text3 && text3.length > DISMISSED_MAX_CHARS) return {};
  let raw;
  try {
    raw = JSON.parse(text3 ?? "");
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
  const version2 = changelog[changelog.length - 1]?.version ?? 0;
  if (handEditOf(changelog, texts)) return true;
  if (top.version >= version2) return false;
  const before = texts.history?.[top.version];
  const after = texts.current ?? texts.history?.[version2];
  if (before === void 0 || after === void 0) return changelog.some((e) => e.version > top.version && entryKind(e) !== "approve");
  const d = changedSections(designBody(before), designBody(after));
  return d.changed.length > 0 || d.removed.length > 0;
}
function designGate(changelog, given, dismissed = {}, texts = {}) {
  const critiques = oneByRound(given);
  const version2 = changelog[changelog.length - 1]?.version ?? 0;
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
    version: version2,
    rounds: valid.length,
    latestRound,
    latestCritiqueVersion,
    criticalPending,
    majorPending,
    invalid: critiques.filter((c) => c.critique === null).map((c) => c.round).sort((a, b) => a - b),
    needsVerify,
    handEdit: handEditOf(changelog, texts),
    canAutoApprove: latest !== null && criticalPending.length === 0 && majorPending.length === 0 && !needsVerify && latestCritiqueVersion !== null && latestCritiqueVersion <= version2,
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
var esc2 = (s) => s.replace(/[&<>"']/g, (c) => ENT[c]);
var SAFE = /^(https?:|mailto:|#)/i;
function renderMarkdown(md) {
  const sections = sectionsOf(md);
  let next = 0;
  const topLevel = /* @__PURE__ */ new Set();
  const marked = new F({ gfm: true, async: false });
  marked.use({
    renderer: {
      html({ text: text3, block }) {
        return block ? `<p>${esc2(text3)}</p>
` : esc2(text3);
      },
      heading(token) {
        const { tokens: tokens2, depth } = token;
        const inner = this.parser.parseInline(tokens2);
        if ((depth === 2 || depth === 3) && topLevel.has(token) && /^#{2,3}\s/.test(token.raw)) {
          const i = sections.findIndex((s, k2) => k2 >= next && s.level === depth && s.heading === token.text);
          if (i >= 0) {
            next = i + 1;
            return `<h${depth} id="${esc2(sections[i].slug)}">${inner}</h${depth}>
`;
          }
        }
        return `<h${depth}>${inner}</h${depth}>
`;
      },
      link({ href, title, tokens: tokens2 }) {
        const text3 = this.parser.parseInline(tokens2);
        if (!SAFE.test(href.trim())) return text3;
        return `<a href="${esc2(href)}"${title ? ` title="${esc2(title)}"` : ""} rel="noopener noreferrer">${text3}</a>`;
      },
      image({ href, text: text3 }) {
        if (!/^https?:/i.test(href.trim())) return esc2(text3);
        return `<img src="${esc2(href)}" alt="${esc2(text3)}" loading="lazy">`;
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
  const earlier = input.changelog.filter((c) => c.version < (numbers[from] ?? Infinity)).sort((a, b) => a.version - b.version).map(({ version: version2, date: date3, note }) => ({ version: version2, date: date3, note }));
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

// src/lib/execution-state.ts
var SAFE_ID2 = /^[A-Za-z0-9_\-.]{1,120}$/;
var isSafeId = (s) => typeof s === "string" && SAFE_ID2.test(s) && s !== "." && s !== "..";
var RUN_BRANCH = /^[A-Za-z0-9_./][A-Za-z0-9_\-./]{0,119}$/;
var isRunBranch = (s) => typeof s === "string" && RUN_BRANCH.test(s) && !s.includes("..");
var TASK_STATUSES2 = ["running", "accepted", "integrated", "conflict", "blocked", "stopped"];
var STOPS = ["finished", "stalled", "stopped", "budget", "migrated"];
var MAX_TASKS = 500;
var isObj6 = (x2) => !!x2 && typeof x2 === "object" && !Array.isArray(x2);
var str4 = (x2) => typeof x2 === "string" && x2 ? x2 : null;
var iso3 = (x2) => typeof x2 === "string" && !Number.isNaN(Date.parse(x2)) ? x2 : null;
var FUTURE_SKEW_MS2 = 12e4;
var finishedOf = (x2, now) => {
  const v = iso3(x2);
  if (!v) return null;
  return now !== void 0 && Number.isFinite(now) && Date.parse(v) - now > FUTURE_SKEW_MS2 ? null : v;
};
var int3 = (x2, min, max, dflt) => typeof x2 === "number" && Number.isInteger(x2) ? Math.min(max, Math.max(min, x2)) : dflt;
var oneOf2 = (list, x2) => list.includes(x2) ? x2 : null;
var cleanTitle = (x2) => typeof x2 === "string" ? x2.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim().slice(0, 200) : "";
function normalizeTask2(x2, now) {
  if (!isObj6(x2)) return null;
  const status2 = oneOf2(TASK_STATUSES2, x2.status);
  const stage = oneOf2(STAGES, x2.stage);
  const executor = oneOf2(["subagents", "sessions", "manual"], x2.executor);
  const worktree = typeof x2.worktree === "string" ? x2.worktree : null;
  const branch = str4(x2.branch);
  const startedAt = iso3(x2.startedAt);
  if (!status2 || !stage || !executor || worktree === null || !branch || !startedAt) return null;
  const title = cleanTitle(x2.title);
  return {
    status: status2,
    stage,
    executor,
    worktree,
    branch,
    startedAt,
    stageSince: iso3(x2.stageSince) ?? startedAt,
    round: int3(x2.round, 0, 99, 0),
    attempts: int3(x2.attempts, 0, 99, 0),
    agent: str4(x2.agent),
    updatedAt: iso3(x2.updatedAt) ?? startedAt,
    detail: typeof x2.detail === "string" ? x2.detail.slice(0, 500) : null,
    ...iso3(x2.nudgedAt) ? { nudgedAt: iso3(x2.nudgedAt) } : {},
    ...finishedOf(x2.finishedAt, now) ? { finishedAt: finishedOf(x2.finishedAt, now) } : {},
    ...title ? { title } : {},
    ...typeof x2.sha === "string" && /^[0-9a-f]{7,40}$/i.test(x2.sha) ? { sha: x2.sha } : {}
  };
}
var SURFACE = /^[A-Za-z0-9_.:-]{1,64}$/;
var surfaceList = (x2) => Array.isArray(x2) ? [...new Set(x2.filter((s) => typeof s === "string" && SURFACE.test(s) && s !== "." && s !== ".."))].slice(0, 100) : null;
var flowOf = (x2) => {
  if (!isObj6(x2) || typeof x2.sha !== "string" || !/^[0-9a-f]{7,64}$/i.test(x2.sha) || !iso3(x2.at)) return null;
  const result = oneOf2(["pass", "fail", "blocked"], x2.result);
  const since = typeof x2.since === "string" && /^[0-9a-f]{7,64}$/i.test(x2.since) ? x2.since : null;
  return result ? { sha: x2.sha, at: x2.at, result, ...since ? { since } : {}, ...x2.whole === true ? { whole: true } : {} } : null;
};
function normalizeExecution(x2, now) {
  if (!isObj6(x2)) return null;
  const mode = oneOf2(["subagents", "sessions"], x2.mode);
  const kind = oneOf2(["plan", "ephemeral"], x2.kind) ?? "plan";
  const runId = str4(x2.runId), project = str4(x2.project), base = str4(x2.base), branch = str4(x2.branch), coordinator = str4(x2.coordinator);
  const startedAt = iso3(x2.startedAt);
  if (!mode || !runId || !project || !base || !branch || !coordinator || !startedAt) return null;
  if (!isSafeId(runId) || !isSafeId(coordinator) || !isRunBranch(branch) || !isSafeId(project)) return null;
  const tasks = {};
  if (isObj6(x2.tasks)) {
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
    parallel: int3(x2.parallel, 1, 10, 3),
    mergeOnFinish: x2.mergeOnFinish === true,
    hookSession: isSafeId(x2.hookSession) ? x2.hookSession : null,
    active: x2.active === true,
    stopReason: oneOf2(STOPS, x2.stopReason),
    stallReason: typeof x2.stallReason === "string" ? x2.stallReason.slice(0, 1e3) : null,
    lastStepAt: iso3(x2.lastStepAt),
    lastBlockStep: iso3(x2.lastBlockStep),
    sleepUntil: iso3(x2.sleepUntil),
    // C2: closedBy only means something with a closedAt; an older file has neither.
    closedAt: iso3(x2.closedAt),
    closedBy: iso3(x2.closedAt) ? oneOf2(["merge", "close"], x2.closedBy) : null,
    ...typeof x2.planned === "number" && Number.isInteger(x2.planned) ? { planned: Math.min(MAX_TASKS, Math.max(0, x2.planned)) } : {},
    ...x2.autonomy === "auto" ? { autonomy: "auto" } : {},
    ...isLocale(x2.locale) ? { locale: x2.locale } : {},
    ...surfaceList(x2.verifySkip) ? { verifySkip: surfaceList(x2.verifySkip) } : {},
    ...x2.flow !== void 0 ? { flow: flowOf(x2.flow) } : {}
  };
}
function parseExecution(text3, now) {
  if (typeof text3 !== "string") return null;
  try {
    return normalizeExecution(JSON.parse(text3), now);
  } catch {
    return null;
  }
}
var LIVE_SILENT_MINUTES = 7;
var LIVE_STOPPED_MINUTES = 12;
var LIVE_MAX_AGE_HOURS = 24;
var FORGE_DOC_MAX_BYTES = 8 * 1024;
function normalizeLive(x2) {
  if (!isObj6(x2)) return null;
  const sessionId = str4(x2.sessionId), ts = iso3(x2.ts);
  const role = oneOf2(["coordinator", "executor", "manual"], x2.role);
  if (!sessionId || !ts || !role) return null;
  const agents = Array.isArray(x2.agents) ? x2.agents.filter(isObj6).map((a) => ({ id: str4(a.id), type: str4(a.type) ?? "", since: iso3(a.since) })).filter((a) => !!a.id && !!a.since).slice(0, 20) : [];
  return { sessionId, role, ts, agents, runId: str4(x2.runId), task: str4(x2.task), event: (str4(x2.event) ?? "").slice(0, 40), ended: x2.ended === true };
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
function date2(x2, now) {
  if (typeof x2 !== "string") return null;
  const t = Date.parse(x2);
  if (!Number.isFinite(t)) return null;
  return now !== void 0 && Number.isFinite(now) && t - now > FUTURE_SKEW_MS2 ? null : x2;
}
function normalizeBound(x2, now) {
  if (!x2 || typeof x2 !== "object" || Array.isArray(x2)) return null;
  const o = x2;
  if (!isSafeId(o.sid) || !isSafeId(o.claude) || !isBoundVia(o.via)) return null;
  const since = date2(o.since, now);
  const seenAt = date2(o.seenAt, now);
  if (!since || !seenAt) return null;
  const ended = o.endedAt === null || o.endedAt === void 0;
  const endedAt = ended ? null : date2(o.endedAt, now);
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
function parseBound(text3, now) {
  if (typeof text3 !== "string" || !text3 || text3.length > BOUND_MAX_BYTES) return null;
  try {
    return normalizeBound(JSON.parse(text3), now);
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
  const own2 = e.hookSession && signal?.sessionId === e.hookSession ? signal : null;
  if (own2?.ended === true) return "stopped";
  const open2 = !!e.hookSession && (activity.bindings ?? []).some((b) => b.claude === e.hookSession && bindingLive(b, now));
  return e.active && (open2 || activity.busy === true) ? "alive" : coordinatorOf(e, own2 ? [own2] : [], now, lastMovedAt(e)).liveness;
}
function coordinatorGone(e, signal, now, activity = {}) {
  if (!e) return false;
  if (e.hookSession && signal?.sessionId === e.hookSession && signal.ended === true) return true;
  return e.active && coordinatorLiveness(e, signal, now, activity) === "stopped";
}

// src/lib/forge-activity.ts
function memberOfHook(members2, sessionId, runId) {
  const byHook = members2.find((m) => m.runId === runId && m.hookSession === sessionId);
  if (byHook) return byHook;
  const direct = members2.find((m) => m.sessionId === sessionId);
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
var NONE2 = { role: "none", subject: null, binding: null, member: null, coordinator: false, since: null, task: null };
var time3 = (s) => {
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
      return { ...NONE2, role: "owner", subject: "execution", coordinator: true, since: lastMovedAt(e) };
    }
    const m = e ? memberOfHook(i.members, sid, e.runId) : null;
    if (e && m && isVisibleRun(e, i.now, "owner")) return { ...NONE2, role: "owner", subject: "execution", member: m, since: m.since, task: m.task };
    const own2 = newest(list.filter((b) => b.claude === sid), (b) => time3(b.seenAt));
    if (own2) return { ...NONE2, role: "owner", subject: "binding", binding: own2, since: own2.since, task: taskOf(own2) };
  }
  if (e && e.active && !i.coordinatorEnded && isVisibleRun(e, i.now, "other-live")) {
    return { ...NONE2, role: "other-live", subject: "execution", since: lastMovedAt(e) };
  }
  if (e && (!e.active || i.coordinatorEnded) && isVisibleRun(e, i.now, "previous")) {
    return { ...NONE2, role: "previous", subject: "execution", since: lastMovedAt(e) };
  }
  const others = list.filter((b) => b.claude !== sid);
  const live = newest(others.filter((b) => bindingLive(b, i.now)), (b) => time3(b.seenAt));
  if (live) return { ...NONE2, role: "other-live", subject: "binding", binding: live, since: live.seenAt, task: taskOf(live) };
  const offerAt = (b) => time3(b.endedAt ?? b.seenAt);
  const offered = others.filter((b) => !bindingLive(b, i.now) && offerAt(b) + PREVIOUS_OFFER_MS > i.now);
  const prev = newest(offered.filter((b) => taskOf(b) !== null), offerAt) ?? newest(offered, offerAt);
  if (prev) return { ...NONE2, role: "previous", subject: "binding", binding: prev, since: prev.endedAt ?? prev.seenAt, task: taskOf(prev) };
  return NONE2;
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
  const text3 = readText(file, BOUND_MAX_BYTES);
  const b = parseBound(text3, now);
  if (b || text3 === null) return b;
  pause(BOUND_REREAD_MS);
  return parseBound(readText(file, BOUND_MAX_BYTES), now);
}
function writeAtomic(file, text3) {
  (0, import_node_fs3.mkdirSync)(import_node_path3.default.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    (0, import_node_fs3.writeFileSync)(tmp, text3);
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
  const own2 = checkoutSid(wpDir, now);
  if (own2 && isSafeId(own2)) out.push({ dir: wpDir, sid: own2, checkout: true, bound: readBinding(wpDir, own2, now) });
  let names = [];
  try {
    names = (0, import_node_fs3.readdirSync)(seatsDir(wpDir), { withFileTypes: true }).filter((d) => d.isDirectory() && isSafeId(d.name) && d.name !== own2).map((d) => d.name).sort().slice(0, MAX_SEATS);
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
    if (!isPlanId(f.slice(0, -5))) continue;
    try {
      const st2 = JSON.parse((0, import_node_fs3.readFileSync)(import_node_path3.default.join(dir, f), "utf8"));
      if ((st2?.status === "claimed" || st2?.status === "in_progress") && typeof st2.owner === "string" && !(st2.owner in out)) out[st2.owner] = f.slice(0, -5);
    } catch {
    }
  }
  return out;
}
function secondSeatOf(wpDir, claude, open2, now, alive = pidAlive) {
  const own2 = checkoutSid(wpDir, now);
  for (let n = 2; n <= MAX_SEATS + 1; n++) {
    const sid = `main-${n}`;
    if (sid === own2) continue;
    const b = readBinding(import_node_path3.default.join(seatsDir(wpDir), sid), sid, now);
    if (!b || b.claude === claude || !boundLive(b, now, alive) && !open2[sid]) return sid;
  }
  return null;
}
function leftSeatOf(seats, open2, now, alive = pidAlive) {
  let best = null;
  let bestAt = -Infinity;
  for (const s of seats) {
    if (!s.bound || !open2[s.sid] || boundLive(s.bound, now, alive)) continue;
    const at2 = Date.parse(settleBinding(s.bound, now, alive).endedAt ?? s.bound.seenAt);
    if (Number.isFinite(at2) && at2 + PREVIOUS_OFFER_MS > now && at2 > bestAt) {
      best = s;
      bestAt = at2;
    }
  }
  return best;
}
var COMMIT_ACTIONS = ["commit", "commit (amend)", "commit (initial)", "commit (merge)", "revert", "cherry-pick"];
var REFLOG_SCAN = 200;
var RECORDED_MAX = 20;
var RECORDED_TOPS = 10;
function headOf(cwd) {
  try {
    const [top, gitDir, head] = (0, import_node_child_process.execFileSync)("git", ["-C", cwd, "rev-parse", "--show-toplevel", "--absolute-git-dir", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split(/\r?\n/).map((l3) => l3.trim());
    return top && gitDir && head && SHA2.test(head) ? { top: import_node_path3.default.resolve(top), gitDir: import_node_path3.default.resolve(gitDir), head } : null;
  } catch {
    return null;
  }
}
function logStatOf(gitDir) {
  try {
    const st2 = (0, import_node_fs3.statSync)(import_node_path3.default.join(gitDir, "logs", "HEAD"));
    return { size: st2.size, mtimeMs: st2.mtimeMs };
  } catch {
    return null;
  }
}
function rebaseInProgress(top) {
  try {
    const out = (0, import_node_child_process.execFileSync)("git", ["-C", top, "rev-parse", "--git-path", "rebase-merge", "--git-path", "rebase-apply"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return out.split(/\r?\n/).map((l3) => l3.trim()).filter(Boolean).some((p) => (0, import_node_fs3.existsSync)(import_node_path3.default.resolve(top, p)));
  } catch {
    return false;
  }
}
function readReflog(top, max = REFLOG_SCAN) {
  let text3;
  try {
    text3 = (0, import_node_child_process.execFileSync)("git", ["-C", top, "log", "-g", "--date=unix", "--format=%gd%x09%H%x09%gs", "-n", String(max), "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return [];
  }
  const out = [];
  for (const line3 of text3.split(/\r?\n/)) {
    const [gd, sha, ...subject] = line3.split("	");
    const m = /^HEAD@\{(\d+)\}$/.exec(gd ?? "");
    if (!m || !sha || !SHA2.test(sha)) continue;
    const s = subject.join("	");
    const colon = s.indexOf(": ");
    out.push({ at: Number(m[1]), sha, action: colon < 0 ? s : s.slice(0, colon), subject: colon < 0 ? "" : s.slice(colon + 2) });
  }
  return out;
}
var REPLAY_ACTION = /^(rebase|pull --rebase)\b.*\((pick|reword|edit|squash|fixup|continue)\)$/;
function replaysSince(entries2, pos) {
  const out = [];
  for (const e of entries2) {
    if (pos && (e.at < pos.at || e.at === pos.at && e.sha === pos.sha)) break;
    if (e.subject && REPLAY_ACTION.test(e.action)) out.push({ subject: e.subject, sha: e.sha });
  }
  return out.reverse();
}
function commitsSince(entries2, pos, since, max) {
  const out = [];
  for (const e of entries2) {
    if (pos && (e.at < pos.at || e.at === pos.at && e.sha === pos.sha)) break;
    if (since !== null && e.at < Math.floor(since / 1e3)) break;
    if (COMMIT_ACTIONS.includes(e.action) && !out.includes(e.sha)) out.push(e.sha);
  }
  return out.slice(0, max).reverse();
}
function taskSinceOf(wpDir, task) {
  if (!isPlanId(task)) return null;
  const text3 = readText(import_node_path3.default.join(wpDir, "dbcache", "state", `${task}.json`), 64 * 1024);
  if (text3 === null) return null;
  try {
    const st2 = JSON.parse(text3);
    for (const v of [st2?.claimedAt, st2?.startedAt]) {
      const t = typeof v === "string" ? Date.parse(v) : NaN;
      if (Number.isFinite(t)) return t;
    }
  } catch {
  }
  return null;
}
function readLastHead(seatDir) {
  const text3 = readText(lastHeadFile(seatDir), 64 * 1024);
  if (text3 === null) return null;
  try {
    const o = JSON.parse(text3);
    if (!o || !isSafeId(o.session) || !o.heads || typeof o.heads !== "object" || Array.isArray(o.heads)) return null;
    const heads = {};
    for (const [k2, v] of Object.entries(o.heads).slice(-HEADS_MAX)) if (typeof v === "string" && SHA2.test(v)) heads[k2] = v;
    const recorded = {};
    if (o.recorded && typeof o.recorded === "object" && !Array.isArray(o.recorded)) {
      for (const [k2, v] of Object.entries(o.recorded).slice(-RECORDED_TOPS)) {
        if (Array.isArray(v)) recorded[k2] = v.filter((s) => typeof s === "string" && SHA2.test(s)).slice(-RECORDED_MAX);
      }
    }
    const reflog = {};
    if (o.reflog && typeof o.reflog === "object" && !Array.isArray(o.reflog)) {
      for (const [k2, v] of Object.entries(o.reflog).slice(-HEADS_MAX)) {
        const p = v;
        if (p && Number.isInteger(p.at) && p.at >= 0 && typeof p.sha === "string" && SHA2.test(p.sha)) reflog[k2] = { at: p.at, sha: p.sha };
      }
    }
    const logs = {};
    if (o.logs && typeof o.logs === "object" && !Array.isArray(o.logs)) {
      for (const [k2, v] of Object.entries(o.logs).slice(-HEADS_MAX)) {
        const s = v;
        if (s && typeof s.size === "number" && typeof s.mtimeMs === "number") logs[k2] = { size: s.size, mtimeMs: s.mtimeMs };
      }
    }
    return { session: o.session, heads, recorded, reflog, logs };
  } catch {
    return null;
  }
}
function writeLastHead(seatDir, doc) {
  const recorded = Object.fromEntries(Object.entries(doc.recorded ?? {}).filter(([, v]) => v.length).slice(-RECORDED_TOPS).map(([k2, v]) => [k2, v.slice(-RECORDED_MAX)]));
  const reflog = Object.fromEntries(Object.entries(doc.reflog ?? {}).slice(-HEADS_MAX));
  const logs = Object.fromEntries(Object.entries(doc.logs ?? {}).slice(-HEADS_MAX));
  const out = { session: doc.session, heads: Object.fromEntries(Object.entries(doc.heads).slice(-HEADS_MAX)), ...Object.keys(recorded).length ? { recorded } : {}, ...Object.keys(reflog).length ? { reflog } : {}, ...Object.keys(logs).length ? { logs } : {} };
  writeAtomic(lastHeadFile(seatDir), `${JSON.stringify(out)}
`);
}
function recordBase(seatDir, session, cwd) {
  const at2 = headOf(cwd);
  if (!at2) return;
  const lh = readLastHead(seatDir);
  const mine = lh && lh.session === session ? lh : null;
  const heads = mine?.heads ?? {};
  const newest2 = readReflog(at2.top, 1)[0];
  const pos = mine?.reflog?.[at2.top];
  if (heads[at2.top] !== at2.head || newest2 && !pos) {
    writeLastHead(seatDir, { session, heads: { ...heads, [at2.top]: at2.head }, recorded: mine?.recorded, logs: mine?.logs, reflog: { ...mine?.reflog, ...newest2 ? { [at2.top]: { at: newest2.at, sha: newest2.sha } } : {} } });
  }
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
function readCommentsSeen(f) {
  const p = import_node_path4.default.join(f.critiques, "comments.json");
  try {
    if ((0, import_node_fs4.statSync)(p).size > COMMENTS_MAX_BYTES) return {};
    return parseCommentsSeen((0, import_node_fs4.readFileSync)(p, "utf8"));
  } catch {
    return {};
  }
}
function writeCommentsSeen(f, s) {
  const p = import_node_path4.default.join(f.critiques, "comments.json");
  const sorted = Object.fromEntries(Object.entries(s).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  writeAtomic(p, `${JSON.stringify(sorted, null, 2)}
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
  const open2 = versions.find((v) => byVersion[v.id].done < byVersion[v.id].total);
  const currentVersion = open2?.id ?? versions.at(-1)?.id ?? null;
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
function worktreeDirs(porcelain) {
  if (typeof porcelain !== "string") return [];
  return porcelain.split(/\r?\n/).filter((l3) => l3.startsWith("worktree ")).map((l3) => l3.slice("worktree ".length).trim()).filter(Boolean);
}
var mainWorktreeFrom = (porcelain) => worktreeDirs(porcelain)[0] ?? null;
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
var hasLine = (text3, line3) => text3.split(/\r?\n/).some((l3) => l3.trim() === line3);
function appendOnce(file, line3) {
  let text3 = "";
  try {
    text3 = (0, import_node_fs5.readFileSync)(file, "utf8");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  if (hasLine(text3, line3)) return;
  (0, import_node_fs5.appendFileSync)(file, `${text3 && !text3.endsWith("\n") ? "\n" : ""}${line3}
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
var import_yaml5 = __toESM(require_dist(), 1);
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
      const raw = (0, import_yaml5.parse)((0, import_node_fs6.readFileSync)(file, "utf8"));
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
  const time4 = (s) => {
    const t = s ? Date.parse(s) : NaN;
    return Number.isFinite(t) ? t : -Infinity;
  };
  const at2 = (b) => Math.max(time4(b.seenAt), time4(b.endedAt));
  const activity = (e) => Math.max(e.mtimeMs, ...e.bindings.map(at2));
  const ownAt = (e) => Math.max(-Infinity, ...e.bindings.filter((b) => b.claude === sessionId).map(at2));
  const own2 = sessionId ? entries2.filter((e) => ownAt(e) > -Infinity) : [];
  const score = (e) => own2.length ? [ownAt(e), activity(e)] : [activity(e)];
  const better = (a, b) => {
    const sa = score(a), sb = score(b);
    for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sb[i] > sa[i] ? 1 : -1;
    return 0;
  };
  return [...own2.length ? own2 : entries2].sort(better)[0].name;
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
  const members2 = newestMemberFiles(files).flatMap((f) => {
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
  return { exec, any, members: members2, infinite: parseRun(read(import_node_path8.default.join(dir, "run.json"))), coordinatorEnded: coordinatorGone(exec, signal, now, { bindings }) };
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
function ownerText(ctx, own2, plan, source, input) {
  if (own2.bound.via === "design") {
    const v = draftVersion(ctx.docDir);
    return v === null ? null : `waypoint: design document ${ctx.project} v${v} (draft). Use /waypoint:design to continue the design loop.`;
  }
  if (!plan) return null;
  const sid = own2.bound.sid;
  if (own2.bound.via === "forge-infinite" || own2.bound.via === "forge-run" && !ctx.viewer.task) {
    return `waypoint: this conversation holds seat ${sid} of project ${ctx.project} (${plan.artifacts.roadmap ?? "not published"}) for its forge ${own2.bound.via === "forge-infinite" ? "infinite run" : "run"}.`;
  }
  let track = "-";
  try {
    const s = JSON.parse(read(import_node_path8.default.join(own2.seat.dir, "session.json")) ?? "{}");
    if (typeof s?.track === "string" && s.track) track = s.track;
  } catch {
    track = "-";
  }
  const cur = ctx.viewer.task ? plan.tasks.find((t) => t.id === ctx.viewer.task) : void 0;
  const open2 = Object.values(readDocs(import_node_path8.default.join(ctx.wp, "dbcache", "messages"), normalizeMessage).docs).filter((m) => m.to === sid && m.status === "open").length;
  const secs = typeof input.seconds_since_last_response === "number" ? input.seconds_since_last_response : 0;
  const resumed = source === "resume" && secs >= 3600 ? `Resumed after ${Math.floor(secs / 3600)} h. ` : "";
  return `${resumed}waypoint: project ${ctx.project} has a live roadmap (${plan.artifacts.roadmap ?? "not published"}). Session ${sid} track ${track}. Current task: ${cur ? `${cur.id} ${cur.title}` : "none"}. Open messages: ${open2}. Use /waypoint:work to continue, /waypoint:status for progress.`;
}
function sessionStart(io, input) {
  const ctx = contextOf(io, input);
  if (!ctx) return "";
  const source = SOURCES.includes(input.source) ? input.source : "startup";
  const say = (text3) => text3 ? JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text3 } }) : "";
  const v = ctx.viewer;
  renewOwn(ctx, io, source === "resume" || source === "compact");
  if (v.subject === "execution") return "";
  const plan = readPlan(ctx.docDir);
  const url = plan?.artifacts.roadmap ?? "not published";
  const title = (t) => plan?.tasks.find((x2) => x2.id === t)?.title ?? "";
  const own2 = ownSeat(ctx);
  if (own2 && ctx.sid) {
    recordBase(own2.seat.dir, ctx.sid, nonEmpty(input.cwd) ?? ctx.root);
    return say(ownerText(ctx, own2, plan, source, input));
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
function othersOn(ctx, own2, top, head) {
  let live = false;
  const seen = /* @__PURE__ */ new Set();
  for (const s of ctx.seats) {
    const b = s.bound;
    if (s === own2 || !b || b.claude === ctx.sid) continue;
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
  const own2 = ctx ? ownSeat(ctx) : null;
  if (!ctx || !own2 || !ctx.sid) return "";
  const sid = ctx.sid;
  const at2 = headOf(nonEmpty(input.cwd) ?? ctx.root);
  if (!at2) return "";
  const lh = readLastHead(own2.seat.dir);
  const mine = lh && lh.session === sid ? lh : null;
  const heads = mine?.heads ?? {};
  const recorded = mine?.recorded ?? {};
  const last = heads[at2.top];
  const stat = logStatOf(at2.gitDir);
  const storedStat = mine?.logs?.[at2.top];
  const statKept = !!stat && storedStat?.size === stat.size && storedStat.mtimeMs === stat.mtimeMs;
  const reflog = last === at2.head && mine?.reflog?.[at2.top] && statKept ? [] : readReflog(at2.top);
  const top = reflog[0] ?? null;
  const pos = mine?.reflog?.[at2.top] ?? (last ? reflog.find((e) => e.sha === last) ?? top : null);
  let newest2 = null;
  const save = () => {
    const stored = mine?.reflog?.[at2.top];
    if (last === at2.head && !newest2 && (statKept || !stat) && (!top || stored?.at === top.at && stored.sha === top.sha)) return;
    writeLastHead(own2.seat.dir, {
      session: sid,
      heads: { ...heads, [at2.top]: at2.head },
      reflog: { ...mine?.reflog, ...top ? { [at2.top]: { at: top.at, sha: top.sha } } : {} },
      recorded: newest2 ? { ...recorded, [at2.top]: [...recorded[at2.top] ?? [], newest2] } : recorded,
      logs: { ...mine?.logs, ...stat ? { [at2.top]: stat } : {} }
    });
  };
  const task = ctx.viewer.task;
  if (!task) {
    save();
    return "";
  }
  const file = import_node_path8.default.join(own2.seat.dir, "pending-commits.jsonl");
  const cmd = typeof input.tool_input?.command === "string" ? input.tool_input.command : "";
  const git = (args) => {
    try {
      return (0, import_node_child_process3.execFileSync)("git", ["-C", at2.top, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      return null;
    }
  };
  let shas = [];
  const claim2 = taskSinceOf(ctx.wp, task);
  if (!pos) {
    if (last === void 0 && claim2 !== null) shas = commitsSince(reflog, null, claim2, MAX_COMMITS);
    else if (isCommitCommand(cmd) && top && COMMIT_ACTIONS.includes(top.action) && top.sha === at2.head) shas = [at2.head];
  } else if (top && !(top.at === pos.at && top.sha === pos.sha)) {
    shas = commitsSince(reflog, pos, claim2, MAX_COMMITS);
  }
  if (shas.length) {
    const others = othersOn(ctx, own2.seat, at2.top, at2.head);
    shas = !others.live || makesCommits(cmd) ? ownShare(shas, others.seen) : [];
  }
  shas = shas.slice(0, MAX_COMMITS).filter((s) => git(["merge-base", "--is-ancestor", s, at2.head]) !== null);
  if (last && last !== at2.head) {
    if (git(["merge-base", "--is-ancestor", last, at2.head]) === null) {
      if (rebaseInProgress(at2.top)) return "";
      const all = lines(file);
      let checked2 = 0;
      const replays = replaysSince(reflog, pos);
      const kept = all.flatMap((l3) => {
        const s = field(l3, "sha");
        if (!s || !SHA3.test(s) || checked2 >= MAX_COMMITS) return [l3];
        checked2++;
        if (git(["merge-base", "--is-ancestor", s, at2.head]) !== null) return [l3];
        const subject = replays.length ? git(["log", "-1", "--format=%s", s])?.trim() : void 0;
        const k2 = subject ? replays.findIndex((r3) => r3.subject === subject && git(["merge-base", "--is-ancestor", r3.sha, at2.head]) !== null) : -1;
        if (k2 < 0) return [];
        const [r2] = replays.splice(k2, 1);
        try {
          return [JSON.stringify({ ...JSON.parse(l3), sha: r2.sha })];
        } catch {
          return [];
        }
      });
      if (kept.length !== all.length || kept.some((l3, i) => l3 !== all[i])) (0, import_node_fs7.writeFileSync)(file, kept.map((l3) => `${l3}
`).join(""));
    }
  }
  const have = new Set(lines(file).map((l3) => field(l3, "sha")));
  const ts = io.now().toISOString();
  const fresh = shas.filter((s) => !have.has(s));
  if (fresh.length) {
    (0, import_node_fs7.appendFileSync)(file, fresh.map((sha) => `${JSON.stringify({ ts, task, sha, command: cmd.slice(0, 200), session: sid, seat: own2.bound.sid })}
`).join(""));
    newest2 = fresh[fresh.length - 1];
  }
  save();
  return "";
}
function stop(io, input) {
  const ctx = contextOf(io, input);
  if (ctx) renewOwn(ctx, io, false);
  const own2 = ctx ? ownSeat(ctx) : null;
  if (!ctx || !own2 || !ctx.sid) return "";
  if (forgeRoleOf({ execution: ctx.forge.any, members: ctx.forge.members, infinite: ctx.forge.infinite }, ctx.sid) !== null) return "";
  const ongoing = ctx.viewer.task;
  const commits = lines(import_node_path8.default.join(own2.seat.dir, "pending-commits.jsonl")).filter((l3) => ongoing === null || field(l3, "task") !== ongoing);
  const queued = lines(import_node_path8.default.join(own2.seat.dir, "queue.jsonl"));
  if (!commits.length && !queued.length) return "";
  const hash = (0, import_node_crypto2.createHash)("sha256").update(JSON.stringify([commits, queued])).digest("hex");
  const ackFile = import_node_path8.default.join(own2.seat.dir, "stop-ack");
  if ((read(ackFile) ?? "").trim() === hash) return "";
  (0, import_node_fs7.writeFileSync)(ackFile, `${hash}
`);
  const rel = import_node_path8.default.relative(ctx.root, own2.seat.dir).split(import_node_path8.default.sep).join("/");
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
function sharingChange(plan, assets, published) {
  if (!plan.artifacts.roadmap) return { capabilitiesChanged: false, ask: null };
  if (published === void 0) return { capabilitiesChanged: true, ask: assets ? sharingChangeAsk(plan, true) : unknownSharingAsk(plan) };
  if (published !== assets) return { capabilitiesChanged: true, ask: sharingChangeAsk(plan, assets) };
  return { capabilitiesChanged: false, ask: null };
}
function unknownSharingAsk(plan) {
  return isEs(plan.locale) ? "El roadmap publicado no registra si guarda las capturas de verificaci\xF3n de forge. Si sigues, se republica sin ellas: podr\xE1 compartirse p\xFAblicamente y las capturas ya subidas dejar\xE1n de verse. Para conservarlas, deja el roadmap como est\xE1 y ejecuta /waypoint:plan assets." : "The published roadmap does not record whether it keeps forge's verification screenshots. Going ahead republishes it without them: it can be shared publicly, and any screenshots already uploaded stop showing. To keep them, keep the roadmap as it is and run /waypoint:plan assets.";
}
function sharingChangeAsk(plan, assets) {
  if (assets) {
    return isEs(plan.locale) ? "Al republicar, el roadmap pasa a guardar las capturas de verificaci\xF3n de forge: quedar\xE1 interno de tu organizaci\xF3n y su enlace p\xFAblico dejar\xE1 de funcionar." : "Republishing makes the roadmap keep forge's verification screenshots: it becomes internal to your organization and its public link stops working.";
  }
  return isEs(plan.locale) ? "Al republicar, el roadmap vuelve a poder compartirse: deja de guardar las capturas de verificaci\xF3n de forge, as\xED que podr\xE1 compartirse p\xFAblicamente; las capturas ya subidas dejar\xE1n de verse y las nuevas de forge se quedan en tu equipo." : "Republishing makes the roadmap shareable again: it stops keeping forge's verification screenshots, so it can be shared publicly; the screenshots already uploaded stop showing, and forge's new ones stay on your machine.";
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
var USAGE = `usage: waypoint <validate|replan|hash|clean-cache|page|sync|doctor|next|conflicts|recover|notes|inbox|escalations|launch|status|session-id|event-id|now|commit-info|claim|done|block|heartbeat|bind|release|design-validate|design-park|design-import|design-snapshot|design-changed|design-gate|design-impact|critique-next|critique-check|critique-select|critique-dismiss|design-comments|design-page|hook> ...`;
function run(argv, io) {
  const [cmd, ...args] = argv;
  const flag = (name) => {
    const i = args.indexOf(`--${name}`);
    const v = i >= 0 ? args[i + 1] : void 0;
    return v === void 0 || v.startsWith("--") ? void 0 : v;
  };
  const abs = (p) => import_node_path9.default.resolve(io.cwd, p);
  const listingWarnings = [];
  const ok = (stdout, stderr = listingWarnings.join("")) => ({ code: 0, stdout: stdout.endsWith("\n") ? stdout : `${stdout}
`, stderr });
  const fail = (stderr, code = 1) => ({ code, stdout: "", stderr: `${listingWarnings.join("")}${stderr}
` });
  const loadPlan = () => parsePlan((0, import_node_fs8.readFileSync)(abs(args[0]), "utf8"));
  const docsIn = (dir, normalize) => {
    if (!dir) return {};
    const r2 = readDocs(abs(dir), normalize);
    for (const f of r2.skipped) listingWarnings.push(`warning: skipped ${dir.replace(/[\\/]+$/, "")}/${f} (unreadable)
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
  const optMessages = () => flag("messages") ? docs("messages", normalizeMessage) : void 0;
  const loadView = () => {
    const p = loadPlan();
    const db = flag("db");
    if (!db) return { view: p, project: p.project, version: p.version };
    const metaFile = import_node_path9.default.join(abs(db), "meta", "project.json");
    const phases = Object.values(docsIn(import_node_path9.default.join(abs(db), "plan"))).map((d) => normalizePhase(d)).filter((x2) => !!x2);
    const meta2 = (0, import_node_fs8.existsSync)(metaFile) ? normalizeMeta(JSON.parse((0, import_node_fs8.readFileSync)(metaFile, "utf8"))) : null;
    if (!meta2 || !phases.length) throw new CacheError("db plan cache missing \u2014 list meta and plan first");
    return { view: planViewFromDocs(meta2, phases), project: p.project, version: meta2.version || p.version };
  };
  const out = (code, value) => ({ code, stdout: `${JSON.stringify(value)}
`, stderr: listingWarnings.join("") });
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
    let text3;
    try {
      text3 = (0, import_node_fs8.readFileSync)(abs(arg), "utf8");
    } catch (e) {
      return fail(`${cmd2}: cannot read the design ${arg}: ${e.message}`, 2);
    }
    try {
      return parseDesign(text3);
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
          const unknown2 = p.tasks.filter((t) => t.design_ref && !slugs.has(t.design_ref)).map((t) => `${t.id} (${t.design_ref})`);
          if (unknown2.length) refs = `
warning: ${unknown2.length} design_ref(s) not in the design: ${unknown2.join(", ")}`;
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
      case "replan": {
        const stray = [];
        for (let i = 1; i < args.length; i++) {
          if (args[i] === "--ops" || args[i] === "--why-file") i++;
          else if (args[i] !== "--check") stray.push(JSON.stringify(args[i].slice(0, 80)));
        }
        if (stray.length) return fail(`replan: unknown argument ${stray.join(", ")} (it takes <plan.yaml> --ops <f> --why-file <f> [--check])`, 2);
        const opsFile = flag("ops"), whyFile = flag("why-file");
        if (!args[0] || args[0].startsWith("--") || !opsFile || !whyFile) return fail("usage: waypoint replan <plan.yaml> --ops <ops.json> --why-file <why.txt> [--check]", 2);
        const file = abs(args[0]);
        const read2 = (f) => {
          const s = (0, import_node_fs8.readFileSync)(abs(f), "utf8");
          return s.charCodeAt(0) === 65279 ? s.slice(1) : s;
        };
        let text3, raw, why;
        try {
          text3 = (0, import_node_fs8.readFileSync)(file, "utf8");
        } catch {
          return fail(`replan: cannot read ${args[0]}`, 2);
        }
        try {
          raw = JSON.parse(read2(opsFile));
        } catch {
          return fail(`replan: cannot read ${opsFile} as JSON`, 2);
        }
        try {
          why = read2(whyFile);
        } catch {
          return fail(`replan: cannot read ${whyFile}`, 2);
        }
        const { ops, errors } = normalizeOps(raw);
        if (errors.length) return fail(new ReplanError(errors).message, 2);
        let r2;
        try {
          r2 = applyReplan(text3, ops, why, io.now().toISOString());
        } catch (e) {
          if (e instanceof ReplanError) return fail(e.message, 2);
          throw e;
        }
        if (args.includes("--check")) return ok(JSON.stringify({ changes: r2.changes }));
        if (r2.text !== text3) writeAtomic(file, r2.text);
        return ok(JSON.stringify({ changes: r2.changes, history: parsePlan(r2.text).history?.length ?? 0 }));
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
        const noAssets = args.includes("--no-assets");
        if (noAssets && args.includes("--assets")) return fail("page: --assets and --no-assets cannot be combined", 2);
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
        const internal = !noAssets && (args.includes("--assets") || before === true);
        const rules = rulesOf(published);
        const assets = declaresAssets(published);
        const changed = pageArg ? sharingChange(p, assets, before) : {};
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
        const own2 = (0, import_node_fs8.existsSync)(outDir) && (0, import_node_fs8.existsSync)(wpDir) ? import_node_path9.default.relative((0, import_node_fs8.realpathSync)(wpDir), (0, import_node_fs8.realpathSync)(outDir)) : "";
        if (own2 && !own2.startsWith("..") && !import_node_path9.default.isAbsolute(own2)) {
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
        const now = io.now().getTime();
        const track = flag("track");
        const leftover = !!sessions && recoverableTasks(view, states, sessions, now).some((t) => t.owner !== session && (!track || view.tasks.find((x2) => x2.id === t.taskId)?.track === track));
        const multi = leftover || multiSession({ sessions, messages: optMessages(), sid: session, inTrackWorktree: inTrackWorktree(io.cwd), now });
        const { unblock, ...rest } = r2;
        return ok(JSON.stringify({ ...unblock ? r2 : rest, multi }));
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
        const minutes2 = Number(flag("minutes") ?? IDLE_MINUTES);
        return ok(JSON.stringify(recoverableTasks(
          view,
          docs("states", stateDoc),
          docs("sessions", sessionDoc),
          io.now().getTime(),
          Number.isFinite(minutes2) ? minutes2 : IDLE_MINUTES
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
        const byFile = (a, b) => `${a}.json` < `${b}.json` ? -1 : `${a}.json` > `${b}.json` ? 1 : 0;
        const all = Object.entries(docsIn(dir, normalizeNote)).sort(([a], [b]) => byFile(a, b)).map(([id, n]) => ({ ...n, id }));
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
        const command = launchCommand({ name, prompt });
        const inWorktree = launchRun({ name, prompt, worktree });
        const log = import_node_path9.default.join(root, ".waypoint", p.project, "launch", `${name}.log`);
        if (args.includes("--exec")) {
          let launchDir;
          try {
            launchDir = (0, import_node_fs8.lstatSync)(import_node_path9.default.dirname(log));
          } catch {
            launchDir = void 0;
          }
          if (launchDir && !launchDir.isDirectory()) return fail(`launch --exec: ${import_node_path9.default.dirname(log)} is not a folder (a link?): remove it and launch again`, 1);
        }
        if (!(0, import_node_fs8.existsSync)(worktree)) {
          excludeHere();
          const exists = git("branch", "--list", branch) !== "";
          git("worktree", "add", worktree, ...exists ? [branch] : ["-b", branch, ...base ? [base] : []]);
        }
        if (args.includes("--exec")) {
          let fd;
          try {
            (0, import_node_fs8.mkdirSync)(import_node_path9.default.dirname(log), { recursive: true });
            (0, import_node_fs8.rmSync)(log, { force: true });
            fd = (0, import_node_fs8.openSync)(log, "wx");
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
        const { view: p, project, version: version2 } = loadView();
        const states = optStates();
        const m = computeMetrics(p, states, io.now().getTime());
        const title = (id) => `${id} ${p.tasks.find((t) => t.id === id)?.title ?? ""}`;
        const lines2 = [
          `${project} \xB7 v${version2} \xB7 ${m.percent}% (${m.done}/${m.total}) \xB7 phases ${m.phasesDone}/${m.phaseCount}`,
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
        const open2 = openTasksOf(wp);
        const own2 = checkoutSid(wp, t);
        const resume = args.includes("--resume");
        const takeover = args.includes("--takeover");
        const seats = readSeats(wp, t);
        const left = leftSeatOf(seats, open2, t);
        const working = seats.find((s) => s.bound?.claude === claude && boundLive(s.bound, t) && !!open2[s.sid]);
        const picked = resume ? working ?? left : void 0;
        let sid;
        if (seatFlag !== void 0) sid = seatFlag;
        else if (picked) sid = picked.sid;
        else if (second) sid = secondSeatOf(wp, claude, open2, t);
        else sid = own2 ?? sessionIdFrom(track ?? "main");
        if (sid === null) return fail(`bind: every extra seat (main-2 to main-${MAX_SEATS + 1}) is held by a live conversation`, 2);
        if (!isSafeId(sid) || sid.startsWith("-")) {
          const fix = seatFlag !== void 0 ? "pick another --seat" : own2 !== null ? `fix the sessionId of ${rel(import_node_path9.default.join(wp, "session.json"))}` : "pick another --track";
          return fail(`bind: the seat id ${JSON.stringify(sid.slice(0, 130))} names a folder: only letters, digits, _ . - and no leading - (${fix})`, 2);
        }
        const seatDir = picked && sid === picked.sid ? picked.dir : second || own2 !== null && own2 !== sid ? import_node_path9.default.join(seatsDir(wp), sid) : wp;
        const cur = readBinding(seatDir, sid, t);
        const task = open2[sid] ?? null;
        const options = ["worktree", "second-seat", "takeover"];
        const prevOf = (raw) => {
          const b = settleBinding(raw, t);
          return { sid: b.sid, claude: b.claude, endedAt: b.endedAt, endReason: b.endReason, seenAt: b.seenAt, task: open2[b.sid] ?? null };
        };
        const held = (b) => ({ held: { sid, claude: b.claude, via: b.via, seenAt: b.seenAt, task }, options, secondSeat: secondSeatOf(wp, claude, open2, t), ...left?.bound && left.sid !== sid ? { previous: prevOf(left.bound) } : {} });
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
        let text3;
        try {
          text3 = (0, import_node_fs8.readFileSync)(file, "utf8");
        } catch {
          return fail(`design-park: cannot read ${args[0]}`, 2);
        }
        const d = parseDesign(text3);
        if (d.meta.status === "parked") return ok(JSON.stringify({ path: file, status: "parked", changed: false }));
        if (d.meta.status !== "draft") return fail(`design-park: only a draft design can be parked (this one is ${d.meta.status})`, 2);
        const next = setDesignStatus(text3, "parked");
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
        let text3;
        try {
          text3 = (0, import_node_fs8.readFileSync)(abs(spec), "utf8");
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
          design = importSpec(text3, { project, locale: flag("locale") ?? "en", source });
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
        const text3 = (0, import_node_fs8.readFileSync)(file, "utf8");
        const d = parseDesign(text3);
        const base = import_node_path9.default.join(import_node_path9.default.dirname(file), "design");
        const histDir = import_node_path9.default.join(base, "history");
        const log = readChangelog(import_node_path9.default.dirname(file));
        const version2 = nextVersion((0, import_node_fs8.existsSync)(histDir) ? (0, import_node_fs8.readdirSync)(histDir) : []);
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
          version: version2,
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
        const dest = import_node_path9.default.join(histDir, `v${version2}.md`);
        try {
          (0, import_node_fs8.writeFileSync)(dest, text3, { flag: "wx" });
        } catch (e) {
          if (e.code === "EEXIST") return fail(`design-snapshot: ${dest} already exists; history is immutable`);
          throw e;
        }
        (0, import_node_fs8.writeFileSync)(import_node_path9.default.join(base, "changelog.json"), JSON.stringify(next, null, 2) + "\n");
        return ok(JSON.stringify({ version: version2, path: dest, ...applied ? { applied } : {}, ...resolved ? { resolved } : {}, ...kind ? { kind } : {} }));
      }
      case "design-changed": {
        const file = abs(args[0]);
        const text3 = (0, import_node_fs8.readFileSync)(file, "utf8");
        const d = parseDesign(text3);
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
        const text3 = (0, import_node_fs8.readFileSync)(file, "utf8");
        const d = parseDesign(text3);
        const files = designFilesOf(file, d.meta.project);
        return ok(JSON.stringify(designGate(readChangelog(files.dir), readCritiques(files), readDismissedOf(files), { history: readHistory(files.dir), current: text3 })));
      }
      case "critique-next": {
        if (!args[0] || args[0].startsWith("--")) return fail("usage: waypoint critique-next <design.md> [--verify] [--full]", 2);
        const file = abs(args[0]);
        const text3 = (0, import_node_fs8.readFileSync)(file, "utf8");
        const d = parseDesign(text3);
        const files = designFilesOf(file, d.meta.project);
        const critiques = readCritiques(files);
        const verify = args.includes("--verify");
        if (verify && !critiques.some((c) => c.critique !== null)) return fail("critique-next: nothing to verify: no critique yet, run a round first", 2);
        const next = nextRound({
          changelog: readChangelog(files.dir),
          critiques,
          history: readHistory(files.dir),
          current: text3,
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
      case "design-comments": {
        const usage = "usage: waypoint design-comments <design.md> [--seen <ids> --round R] [--taken <ids> --version V]";
        if (!args[0] || args[0].startsWith("--")) return fail(usage, 2);
        const design = readDesignArg("design-comments", args[0]);
        if ("code" in design) return design;
        const idsOf = (name, value) => {
          if (!args.includes(`--${name}`)) return null;
          const ids = threadIds(value ?? "");
          return ids ?? fail(`design-comments: --${name} needs thread ids (printable, no space), comma-separated: ${usage}`, 2);
        };
        const seen = idsOf("seen", flag("seen"));
        if (seen && !Array.isArray(seen)) return seen;
        const taken = idsOf("taken", flag("taken"));
        if (taken && !Array.isArray(taken)) return taken;
        let round = 0, version2 = 0;
        if (seen) {
          const n = posInt("round");
          if (n === null) return fail("design-comments: --seen needs --round, a positive integer: the round of the critic that got these threads", 2);
          round = n;
        }
        if (taken) {
          const n = posInt("version");
          if (n === null) return fail("design-comments: --taken needs --version, a positive integer: the version that applied the proposals taking these threads up", 2);
          version2 = n;
        }
        const files = designFilesOf(abs(args[0]), design.meta.project);
        const current = readCommentsSeen(files);
        let next = seen ? markSeen(current, seen, round) : current;
        if (taken) {
          const missing = unseenOf(next, taken);
          if (missing.length) return fail(`design-comments: no critic got thread ${missing.join(", ")} (no --seen for it): leave it out of --taken`, 2);
          next = markTaken(next, taken, version2);
        }
        if (seen || taken) writeCommentsSeen(files, next);
        return ok(JSON.stringify({ threads: next }));
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
          const warnings = [];
          if (changedFlag !== void 0 && c.scope === "changed") {
            for (const p of c.proposals) {
              if (!allowed.includes(p.section)) warnings.push(`warning: proposal ${p.n} reviews "${line2(p.section)}", outside the changed sections (${line2(allowed.join(", "))})`);
            }
          }
          const text3 = formatProposals(c, flag("locale") ?? "en", headings);
          return { code: 0, stdout: text3.endsWith("\n") ? text3 : `${text3}
`, stderr: warnings.length ? `${warnings.join("\n")}
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
function inTrackWorktree(cwd) {
  for (let dir = import_node_path9.default.resolve(cwd); ; dir = import_node_path9.default.dirname(dir)) {
    const git = import_node_path9.default.join(dir, ".git");
    if ((0, import_node_fs8.existsSync)(git)) {
      try {
        const m = (0, import_node_fs8.statSync)(git).isFile() ? /^gitdir:\s*(.+?)\s*$/m.exec((0, import_node_fs8.readFileSync)(git, "utf8")) : null;
        const gitdir = m ? import_node_path9.default.resolve(dir, m[1]) : null;
        return !!gitdir && /[\\/]\.git[\\/]worktrees[\\/][^\\/]+$/.test(gitdir) && /^ref:\s*refs\/heads\/track\//.test((0, import_node_fs8.readFileSync)(import_node_path9.default.join(gitdir, "HEAD"), "utf8"));
      } catch {
        return false;
      }
    }
    if (import_node_path9.default.dirname(dir) === dir) return false;
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
