var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/lens/register.tsx
import { atom, read, update } from "claude-code";

// src/lib/deps.ts
var statusOf = (states, id2) => states[id2]?.status ?? "free";

// src/lib/metrics.ts
function computeMetrics(plan, states, now, activeSessions = 1) {
  const st = (id2) => statusOf(states, id2);
  const total = plan.tasks.length;
  const done = plan.tasks.filter((t) => st(t.id) === "done").length;
  const byPhase = {};
  for (const ph of plan.phases) {
    const ts = plan.tasks.filter((t) => t.phase === ph.id);
    const d = ts.filter((t) => st(t.id) === "done").length;
    const started = ts.some((t) => st(t.id) !== "free");
    byPhase[ph.id] = { done: d, total: ts.length, status: ts.length > 0 && d === ts.length ? "done" : started ? "in_progress" : ph.plan_status };
  }
  const byTrack = {};
  for (const tr of plan.tracks) {
    const ts = plan.tasks.filter((t) => t.track === tr.id);
    byTrack[tr.id] = { done: ts.filter((t) => st(t.id) === "done").length, total: ts.length };
  }
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
  const remaining = total - done;
  const etaIso = paceMin != null && remaining > 0 ? new Date(now + remaining * paceMin * 6e4 / Math.max(1, activeSessions)).toISOString() : null;
  return {
    total,
    done,
    percent: total ? Math.round(done / total * 100) : 0,
    inProgress: plan.tasks.filter((t) => ["claimed", "in_progress"].includes(st(t.id))).map((t) => t.id),
    blocked: plan.tasks.filter((t) => st(t.id) === "blocked").map((t) => t.id),
    phasesDone: Object.values(byPhase).filter((p) => p.status === "done").length,
    phaseCount: plan.phases.length,
    paceMin,
    etaIso,
    startedAt: starts.length ? new Date(Math.min(...starts)).toISOString() : null,
    byPhase,
    byTrack
  };
}

// src/lib/coordination.ts
var SILENT_MINUTES = 5;
function liveness(now, leaseUntil) {
  const until = typeof leaseUntil === "number" ? leaseUntil : typeof leaseUntil === "string" ? Date.parse(leaseUntil) : NaN;
  if (!Number.isFinite(until)) return "stopped";
  if (now < until) return "alive";
  return now - until < SILENT_MINUTES * 6e4 ? "silent" : "stopped";
}
function inboxFor(messages, sessionId2) {
  return Object.entries(messages).filter((e) => !!e[1]).filter(([, m]) => m.status === "open" && m.from !== sessionId2 && (m.to === sessionId2 || m.to === "*")).map(([id2, m]) => ({ ...m, id: id2 })).sort((a, b) => {
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
    const k = threadKey(m);
    threads.set(k, [...threads.get(k) ?? [], m]);
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
  const json2 = JSON.stringify(obj, null, 2);
  return json2.replace(/"([^"]+)":/g, "$1:");
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
function setErrorMap(map2) {
  overrideErrorMap = map2;
}
function getErrorMap() {
  return overrideErrorMap;
}

// node_modules/zod/v3/helpers/parseUtil.js
var makeIssue = (params) => {
  const { data, path, errorMaps, issueData } = params;
  const fullPath = [...path, ...issueData.path || []];
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
  for (const map2 of maps) {
    errorMessage = map2(fullIssue, { data, defaultError: errorMessage }).message;
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
    for (const s of results) {
      if (s.status === "aborted")
        return INVALID;
      if (s.status === "dirty")
        status.dirty();
      arrayValue.push(s.value);
    }
    return { status: status.value, value: arrayValue };
  }
  static async mergeObjectAsync(status, pairs2) {
    const syncPairs = [];
    for (const pair of pairs2) {
      const key = await pair.key;
      const value = await pair.value;
      syncPairs.push({
        key,
        value
      });
    }
    return _ParseStatus.mergeObjectSync(status, syncPairs);
  }
  static mergeObjectSync(status, pairs2) {
    const finalObject = {};
    for (const pair of pairs2) {
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
  constructor(parent, value, path, key) {
    this._cachedPath = [];
    this.parent = parent;
    this.data = value;
    this._path = path;
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
ZodArray.create = (schema4, params) => {
  return new ZodArray({
    type: schema4,
    minLength: null,
    maxLength: null,
    exactLength: null,
    typeName: ZodFirstPartyTypeKind.ZodArray,
    ...processCreateParams(params)
  });
};
function deepPartialify(schema4) {
  if (schema4 instanceof ZodObject) {
    const newShape = {};
    for (const key in schema4.shape) {
      const fieldSchema = schema4.shape[key];
      newShape[key] = ZodOptional.create(deepPartialify(fieldSchema));
    }
    return new ZodObject({
      ...schema4._def,
      shape: () => newShape
    });
  } else if (schema4 instanceof ZodArray) {
    return new ZodArray({
      ...schema4._def,
      type: deepPartialify(schema4.element)
    });
  } else if (schema4 instanceof ZodOptional) {
    return ZodOptional.create(deepPartialify(schema4.unwrap()));
  } else if (schema4 instanceof ZodNullable) {
    return ZodNullable.create(deepPartialify(schema4.unwrap()));
  } else if (schema4 instanceof ZodTuple) {
    return ZodTuple.create(schema4.items.map((item) => deepPartialify(item)));
  } else {
    return schema4;
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
    const pairs2 = [];
    for (const key of shapeKeys) {
      const keyValidator = shape[key];
      const value = ctx.data[key];
      pairs2.push({
        key: { status: "valid", value: key },
        value: keyValidator._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (this._def.catchall instanceof ZodNever) {
      const unknownKeys = this._def.unknownKeys;
      if (unknownKeys === "passthrough") {
        for (const key of extraKeys) {
          pairs2.push({
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
        pairs2.push({
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
        for (const pair of pairs2) {
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
      return ParseStatus.mergeObjectSync(status, pairs2);
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
  setKey(key, schema4) {
    return this.augment({ [key]: schema4 });
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
      let dirty2 = void 0;
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
        } else if (result.status === "dirty" && !dirty2) {
          dirty2 = { result, ctx: childCtx };
        }
        if (childCtx.common.issues.length) {
          issues.push(childCtx.common.issues);
        }
      }
      if (dirty2) {
        ctx.common.issues.push(...dirty2.ctx.common.issues);
        return dirty2.result;
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
      const schema4 = this._def.items[itemIndex] || this._def.rest;
      if (!schema4)
        return null;
      return schema4._parse(new ParseInputLazyPath(ctx, item, ctx.path, itemIndex));
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
ZodTuple.create = (schemas2, params) => {
  if (!Array.isArray(schemas2)) {
    throw new Error("You must pass an array of schemas to z.tuple([ ... ])");
  }
  return new ZodTuple({
    items: schemas2,
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
    const pairs2 = [];
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    for (const key in ctx.data) {
      pairs2.push({
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, key)),
        value: valueType._parse(new ParseInputLazyPath(ctx, ctx.data[key], ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (ctx.common.async) {
      return ParseStatus.mergeObjectAsync(status, pairs2);
    } else {
      return ParseStatus.mergeObjectSync(status, pairs2);
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
    const pairs2 = [...ctx.data.entries()].map(([key, value], index) => {
      return {
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, [index, "key"])),
        value: valueType._parse(new ParseInputLazyPath(ctx, value, ctx.path, [index, "value"]))
      };
    });
    if (ctx.common.async) {
      const finalMap = /* @__PURE__ */ new Map();
      return Promise.resolve().then(async () => {
        for (const pair of pairs2) {
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
      for (const pair of pairs2) {
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
ZodPromise.create = (schema4, params) => {
  return new ZodPromise({
    type: schema4,
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
ZodEffects.create = (schema4, effect, params) => {
  return new ZodEffects({
    schema: schema4,
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    effect,
    ...processCreateParams(params)
  });
};
ZodEffects.createWithPreprocess = (preprocess, schema4, params) => {
  return new ZodEffects({
    schema: schema4,
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
      const r = check(data);
      if (r instanceof Promise) {
        return r.then((r2) => {
          if (!r2) {
            const params = cleanParams(_params, data);
            const _fatal = params.fatal ?? fatal ?? true;
            ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
          }
        });
      }
      if (!r) {
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

// src/lib/critique.ts
var CATEGORIES = ["scope", "done_criteria", "risk", "contradiction", "gap"];
var SEVERITIES = ["critical", "major", "minor"];
var VERDICTS = ["ready", "changes"];
var ProposalSchema = external_exports.object({
  n: external_exports.number().int().positive(),
  category: external_exports.enum(CATEGORIES),
  severity: external_exports.enum(SEVERITIES),
  section: external_exports.string().min(1),
  problem: external_exports.string().min(1),
  change: external_exports.string().min(1)
});
var CritiqueSchema = external_exports.object({
  round: external_exports.number().int().positive(),
  version: external_exports.number().int().positive(),
  scope: external_exports.enum(["full", "changed"]),
  // K3-04: optional, so the critiques written before it still read; parseCritique fills it in.
  verdict: external_exports.enum(VERDICTS).optional(),
  proposals: external_exports.array(ProposalSchema)
});
var CritiqueError = class extends Error {
  constructor(issues) {
    super(`Invalid critique:
- ${issues.join("\n- ")}`);
    this.issues = issues;
    this.name = "CritiqueError";
  }
};
function verdictOf(c2) {
  return c2.proposals.some((p) => p.severity !== "minor") ? "changes" : "ready";
}
function parseCritique(text2) {
  let raw;
  try {
    raw = JSON.parse(text2);
  } catch {
    throw new CritiqueError(["critique is not valid JSON"]);
  }
  const r = CritiqueSchema.safeParse(raw);
  const issues = r.success ? [] : r.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
  const props = raw?.proposals;
  if (Array.isArray(props)) {
    const ns = props.map((p) => p?.n);
    if (!ns.every((n2, i) => n2 === i + 1)) issues.push(`proposals must be numbered 1..${props.length} without gaps`);
  }
  if (issues.length || !r.success) throw new CritiqueError(issues);
  const expected = verdictOf(r.data);
  if (r.data.verdict !== void 0 && r.data.verdict !== expected) {
    const serious = r.data.proposals.find((p) => p.severity !== "minor");
    throw new CritiqueError([serious ? `verdict is "${r.data.verdict}" but proposal ${serious.n} is ${serious.severity}` : `verdict is "${r.data.verdict}" but no proposal is critical or major`]);
  }
  return { ...r.data, verdict: r.data.verdict ?? expected };
}

// src/lib/history.ts
var ENTRY_KINDS = ["draft", "round", "apply", "rewrite", "interview", "approve", "amend", "reopen"];
var EntrySchema = external_exports.object({
  version: external_exports.number(),
  date: external_exports.string(),
  note: external_exports.string(),
  words: external_exports.number(),
  round: external_exports.number()
});
function normalizeApplied(x) {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const out = {};
  for (const [k, v] of Object.entries(x)) {
    if (!/^[1-9]\d*$/.test(k) || !Array.isArray(v)) continue;
    const ns = v.filter((n2) => Number.isInteger(n2) && n2 > 0);
    if (ns.length) out[Number(k)] = [...new Set(ns)].sort((a, b) => a - b);
  }
  return Object.keys(out).length ? out : null;
}
function normalizeResolved(x) {
  if (!Array.isArray(x)) return null;
  const positive = (v) => typeof v === "number" && Number.isInteger(v) && v > 0;
  const seen = /* @__PURE__ */ new Map();
  for (const item of x) {
    if (!item || typeof item !== "object") continue;
    const { round, n: n2 } = item;
    if (positive(round) && positive(n2)) seen.set(`${round}:${n2}`, { round, n: n2 });
  }
  const out = [...seen.values()].sort((a, b) => a.round - b.round || a.n - b.n);
  return out.length ? out : null;
}
function parseChangelog(text2) {
  if (!text2 || !text2.trim()) return [];
  let raw;
  try {
    raw = JSON.parse(text2);
  } catch {
    throw new Error("changelog.json is not valid JSON");
  }
  if (!Array.isArray(raw)) throw new Error("changelog.json must be a JSON array");
  return raw.map((e, i) => {
    const r = EntrySchema.safeParse(e);
    if (!r.success) {
      const why = r.error.issues.map((x) => `${x.path.join(".") || "(root)"}: ${x.message}`).join("; ");
      throw new Error(`changelog.json entry ${i} is invalid: ${why}`);
    }
    const entry = e;
    const applied = normalizeApplied(entry.applied);
    const resolved = normalizeResolved(entry.resolved);
    const kind = typeof entry.kind === "string" && ENTRY_KINDS.includes(entry.kind) ? entry.kind : null;
    return {
      ...r.data,
      ...applied ? { applied } : {},
      ...entry.rewrite === true ? { rewrite: true } : {},
      ...resolved ? { resolved } : {},
      ...kind ? { kind } : {}
    };
  });
}

// node_modules/yaml/browser/dist/nodes/identity.js
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

// node_modules/yaml/browser/dist/visit.js
var BREAK = Symbol("break visit");
var SKIP = Symbol("skip children");
var REMOVE = Symbol("remove node");
function visit(node, visitor) {
  const visitor_ = initVisitor(visitor);
  if (isDocument(node)) {
    const cd = visit_(null, node.contents, visitor_, Object.freeze([node]));
    if (cd === REMOVE)
      node.contents = null;
  } else
    visit_(null, node, visitor_, Object.freeze([]));
}
visit.BREAK = BREAK;
visit.SKIP = SKIP;
visit.REMOVE = REMOVE;
function visit_(key, node, visitor, path) {
  const ctrl = callVisitor(key, node, visitor, path);
  if (isNode(ctrl) || isPair(ctrl)) {
    replaceNode(key, path, ctrl);
    return visit_(key, ctrl, visitor, path);
  }
  if (typeof ctrl !== "symbol") {
    if (isCollection(node)) {
      path = Object.freeze(path.concat(node));
      for (let i = 0; i < node.items.length; ++i) {
        const ci = visit_(i, node.items[i], visitor, path);
        if (typeof ci === "number")
          i = ci - 1;
        else if (ci === BREAK)
          return BREAK;
        else if (ci === REMOVE) {
          node.items.splice(i, 1);
          i -= 1;
        }
      }
    } else if (isPair(node)) {
      path = Object.freeze(path.concat(node));
      const ck = visit_("key", node.key, visitor, path);
      if (ck === BREAK)
        return BREAK;
      else if (ck === REMOVE)
        node.key = null;
      const cv = visit_("value", node.value, visitor, path);
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
  if (isDocument(node)) {
    const cd = await visitAsync_(null, node.contents, visitor_, Object.freeze([node]));
    if (cd === REMOVE)
      node.contents = null;
  } else
    await visitAsync_(null, node, visitor_, Object.freeze([]));
}
visitAsync.BREAK = BREAK;
visitAsync.SKIP = SKIP;
visitAsync.REMOVE = REMOVE;
async function visitAsync_(key, node, visitor, path) {
  const ctrl = await callVisitor(key, node, visitor, path);
  if (isNode(ctrl) || isPair(ctrl)) {
    replaceNode(key, path, ctrl);
    return visitAsync_(key, ctrl, visitor, path);
  }
  if (typeof ctrl !== "symbol") {
    if (isCollection(node)) {
      path = Object.freeze(path.concat(node));
      for (let i = 0; i < node.items.length; ++i) {
        const ci = await visitAsync_(i, node.items[i], visitor, path);
        if (typeof ci === "number")
          i = ci - 1;
        else if (ci === BREAK)
          return BREAK;
        else if (ci === REMOVE) {
          node.items.splice(i, 1);
          i -= 1;
        }
      }
    } else if (isPair(node)) {
      path = Object.freeze(path.concat(node));
      const ck = await visitAsync_("key", node.key, visitor, path);
      if (ck === BREAK)
        return BREAK;
      else if (ck === REMOVE)
        node.key = null;
      const cv = await visitAsync_("value", node.value, visitor, path);
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
function callVisitor(key, node, visitor, path) {
  if (typeof visitor === "function")
    return visitor(key, node, path);
  if (isMap(node))
    return visitor.Map?.(key, node, path);
  if (isSeq(node))
    return visitor.Seq?.(key, node, path);
  if (isPair(node))
    return visitor.Pair?.(key, node, path);
  if (isScalar(node))
    return visitor.Scalar?.(key, node, path);
  if (isAlias(node))
    return visitor.Alias?.(key, node, path);
  return void 0;
}
function replaceNode(key, path, node) {
  const parent = path[path.length - 1];
  if (isCollection(parent)) {
    parent.items[key] = node;
  } else if (isPair(parent)) {
    if (key === "key")
      parent.key = node;
    else
      parent.value = node;
  } else if (isDocument(parent)) {
    parent.contents = node;
  } else {
    const pt = isAlias(parent) ? "alias" : "scalar";
    throw new Error(`Cannot replace node with ${pt} parent`);
  }
}

// node_modules/yaml/browser/dist/doc/directives.js
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
    if (doc && tagEntries.length > 0 && isNode(doc.contents)) {
      const tags = {};
      visit(doc.contents, (_key, node) => {
        if (isNode(node) && node.tag)
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

// node_modules/yaml/browser/dist/doc/anchors.js
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
  visit(root, {
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
        if (typeof ref === "object" && ref.anchor && (isScalar(ref.node) || isCollection(ref.node))) {
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

// node_modules/yaml/browser/dist/doc/applyReviver.js
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

// node_modules/yaml/browser/dist/nodes/toJS.js
function toJS(value, arg, ctx) {
  if (Array.isArray(value))
    return value.map((v, i) => toJS(v, String(i), ctx));
  if (value && typeof value.toJSON === "function") {
    if (!ctx || !hasAnchor(value))
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

// node_modules/yaml/browser/dist/nodes/Node.js
var NodeBase = class {
  constructor(type) {
    Object.defineProperty(this, NODE_TYPE, { value: type });
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
    if (!isDocument(doc))
      throw new TypeError("A document argument is required");
    const ctx = {
      anchors: /* @__PURE__ */ new Map(),
      doc,
      keep: true,
      mapAsMap: mapAsMap === true,
      mapKeyWarned: false,
      maxAliasCount: typeof maxAliasCount === "number" ? maxAliasCount : 100
    };
    const res = toJS(this, "", ctx);
    if (typeof onAnchor === "function")
      for (const { count: count2, res: res2 } of ctx.anchors.values())
        onAnchor(res2, count2);
    return typeof reviver === "function" ? applyReviver(reviver, { "": res }, "", res) : res;
  }
};

// node_modules/yaml/browser/dist/nodes/Alias.js
var Alias = class extends NodeBase {
  constructor(source) {
    super(ALIAS);
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
      visit(doc, {
        Node: (_key, node) => {
          if (isAlias(node) || hasAnchor(node))
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
      const { anchors, doc: doc2, maxAliasCount } = ctx;
      let data = anchors.get(found);
      if (!data) {
        toJS(found, null, ctx);
        data = anchors.get(found);
      }
      if (data?.res === void 0) {
        const msg = "This should not happen: Alias anchor was not resolved?";
        throw new ReferenceError(msg);
      }
      if (maxAliasCount >= 0) {
        data.count += 1;
        if (data.aliasCount === 0)
          data.aliasCount = getAliasCount(doc2, found, anchors);
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
      anchorIsValid(this.source);
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
function getAliasCount(doc, node, anchors) {
  if (isAlias(node)) {
    const source = node.resolve(doc);
    const anchor = anchors && source && anchors.get(source);
    return anchor ? anchor.count * anchor.aliasCount : 0;
  } else if (isCollection(node)) {
    let count2 = 0;
    for (const item of node.items) {
      const c2 = getAliasCount(doc, item, anchors);
      if (c2 > count2)
        count2 = c2;
    }
    return count2;
  } else if (isPair(node)) {
    const kc = getAliasCount(doc, node.key, anchors);
    const vc = getAliasCount(doc, node.value, anchors);
    return Math.max(kc, vc);
  }
  return 1;
}

// node_modules/yaml/browser/dist/nodes/Scalar.js
var isScalarValue = (value) => !value || typeof value !== "function" && typeof value !== "object";
var Scalar = class extends NodeBase {
  constructor(value) {
    super(SCALAR);
    this.value = value;
  }
  toJSON(arg, ctx) {
    return ctx?.keep ? this.value : toJS(this.value, arg, ctx);
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

// node_modules/yaml/browser/dist/doc/createNode.js
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
  if (isDocument(value))
    value = value.contents;
  if (isNode(value))
    return value;
  if (isPair(value)) {
    const map2 = ctx.schema[MAP].createNode?.(ctx.schema, null, ctx);
    map2.items.push(value);
    return map2;
  }
  if (value instanceof String || value instanceof Number || value instanceof Boolean || typeof BigInt !== "undefined" && value instanceof BigInt) {
    value = value.valueOf();
  }
  const { aliasDuplicateObjects, onAnchor, onTagObj, schema: schema4, sourceObjects } = ctx;
  let ref = void 0;
  if (aliasDuplicateObjects && value && typeof value === "object") {
    ref = sourceObjects.get(value);
    if (ref) {
      ref.anchor ?? (ref.anchor = onAnchor(value));
      return new Alias(ref.anchor);
    } else {
      ref = { anchor: null, node: null };
      sourceObjects.set(value, ref);
    }
  }
  if (tagName?.startsWith("!!"))
    tagName = defaultTagPrefix + tagName.slice(2);
  let tagObj = findTagObject(value, tagName, schema4.tags);
  if (!tagObj) {
    if (value && typeof value.toJSON === "function") {
      value = value.toJSON();
    }
    if (!value || typeof value !== "object") {
      const node2 = new Scalar(value);
      if (ref)
        ref.node = node2;
      return node2;
    }
    tagObj = value instanceof Map ? schema4[MAP] : Symbol.iterator in Object(value) ? schema4[SEQ] : schema4[MAP];
  }
  if (onTagObj) {
    onTagObj(tagObj);
    delete ctx.onTagObj;
  }
  const node = tagObj?.createNode ? tagObj.createNode(ctx.schema, value, ctx) : typeof tagObj?.nodeClass?.from === "function" ? tagObj.nodeClass.from(ctx.schema, value, ctx) : new Scalar(value);
  if (tagName)
    node.tag = tagName;
  else if (!tagObj.default)
    node.tag = tagObj.tag;
  if (ref)
    ref.node = node;
  return node;
}

// node_modules/yaml/browser/dist/nodes/Collection.js
function collectionFromPath(schema4, path, value) {
  let v = value;
  for (let i = path.length - 1; i >= 0; --i) {
    const k = path[i];
    if (typeof k === "number" && Number.isInteger(k) && k >= 0) {
      const a = [];
      a[k] = v;
      v = a;
    } else {
      v = /* @__PURE__ */ new Map([[k, v]]);
    }
  }
  return createNode(v, void 0, {
    aliasDuplicateObjects: false,
    keepUndefined: false,
    onAnchor: () => {
      throw new Error("This should not happen, please report a bug.");
    },
    schema: schema4,
    sourceObjects: /* @__PURE__ */ new Map()
  });
}
var isEmptyPath = (path) => path == null || typeof path === "object" && !!path[Symbol.iterator]().next().done;
var Collection = class extends NodeBase {
  constructor(type, schema4) {
    super(type);
    Object.defineProperty(this, "schema", {
      value: schema4,
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
  clone(schema4) {
    const copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
    if (schema4)
      copy.schema = schema4;
    copy.items = copy.items.map((it) => isNode(it) || isPair(it) ? it.clone(schema4) : it);
    if (this.range)
      copy.range = this.range.slice();
    return copy;
  }
  /**
   * Adds a value to the collection. For `!!map` and `!!omap` the value must
   * be a Pair instance or a `{ key, value }` object, which may not have a key
   * that already exists in the map.
   */
  addIn(path, value) {
    if (isEmptyPath(path))
      this.add(value);
    else {
      const [key, ...rest] = path;
      const node = this.get(key, true);
      if (isCollection(node))
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
  deleteIn(path) {
    const [key, ...rest] = path;
    if (rest.length === 0)
      return this.delete(key);
    const node = this.get(key, true);
    if (isCollection(node))
      return node.deleteIn(rest);
    else
      throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
  }
  /**
   * Returns item at `key`, or `undefined` if not found. By default unwraps
   * scalar values from their surrounding node; to disable set `keepScalar` to
   * `true` (collections are always returned intact).
   */
  getIn(path, keepScalar) {
    const [key, ...rest] = path;
    const node = this.get(key, true);
    if (rest.length === 0)
      return !keepScalar && isScalar(node) ? node.value : node;
    else
      return isCollection(node) ? node.getIn(rest, keepScalar) : void 0;
  }
  hasAllNullValues(allowScalar) {
    return this.items.every((node) => {
      if (!isPair(node))
        return false;
      const n2 = node.value;
      return n2 == null || allowScalar && isScalar(n2) && n2.value == null && !n2.commentBefore && !n2.comment && !n2.tag;
    });
  }
  /**
   * Checks if the collection includes a value with the key `key`.
   */
  hasIn(path) {
    const [key, ...rest] = path;
    if (rest.length === 0)
      return this.has(key);
    const node = this.get(key, true);
    return isCollection(node) ? node.hasIn(rest) : false;
  }
  /**
   * Sets a value in this collection. For `!!set`, `value` needs to be a
   * boolean to add/remove the item from the set.
   */
  setIn(path, value) {
    const [key, ...rest] = path;
    if (rest.length === 0) {
      this.set(key, value);
    } else {
      const node = this.get(key, true);
      if (isCollection(node))
        node.setIn(rest, value);
      else if (node === void 0 && this.schema)
        this.set(key, collectionFromPath(this.schema, rest, value));
      else
        throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
    }
  }
};

// node_modules/yaml/browser/dist/stringify/stringifyComment.js
var stringifyComment = (str6) => str6.replace(/^(?!$)(?: $)?/gm, "#");
function indentComment(comment, indent) {
  if (/^\n+$/.test(comment))
    return comment.substring(1);
  return indent ? comment.replace(/^(?! *$)/gm, indent) : comment;
}
var lineComment = (str6, indent, comment) => str6.endsWith("\n") ? indentComment(comment, indent) : comment.includes("\n") ? "\n" + indentComment(comment, indent) : (str6.endsWith(" ") ? "" : " ") + comment;

// node_modules/yaml/browser/dist/stringify/foldFlowLines.js
var FOLD_FLOW = "flow";
var FOLD_BLOCK = "block";
var FOLD_QUOTED = "quoted";
function foldFlowLines(text2, indent, mode = "flow", { indentAtStart, lineWidth = 80, minContentWidth = 20, onFold, onOverflow } = {}) {
  if (!lineWidth || lineWidth < 0)
    return text2;
  if (lineWidth < minContentWidth)
    minContentWidth = 0;
  const endStep = Math.max(1 + minContentWidth, 1 + lineWidth - indent.length);
  if (text2.length <= endStep)
    return text2;
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
    i = consumeMoreIndentedLines(text2, i, indent.length);
    if (i !== -1)
      end = i + endStep;
  }
  for (let ch; ch = text2[i += 1]; ) {
    if (mode === FOLD_QUOTED && ch === "\\") {
      escStart = i;
      switch (text2[i + 1]) {
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
        i = consumeMoreIndentedLines(text2, i, indent.length);
      end = i + indent.length + endStep;
      split = void 0;
    } else {
      if (ch === " " && prev && prev !== " " && prev !== "\n" && prev !== "	") {
        const next = text2[i + 1];
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
            ch = text2[i += 1];
            overflow = true;
          }
          const j = i > escEnd + 1 ? i - 2 : escStart - 1;
          if (escapedFolds[j])
            return text2;
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
    return text2;
  if (onFold)
    onFold();
  let res = text2.slice(0, folds[0]);
  for (let i2 = 0; i2 < folds.length; ++i2) {
    const fold = folds[i2];
    const end2 = folds[i2 + 1] || text2.length;
    if (fold === 0)
      res = `
${indent}${text2.slice(0, end2)}`;
    else {
      if (mode === FOLD_QUOTED && escapedFolds[fold])
        res += `${text2[fold]}\\`;
      res += `
${indent}${text2.slice(fold + 1, end2)}`;
    }
  }
  return res;
}
function consumeMoreIndentedLines(text2, i, indent) {
  let end = i;
  let start = i + 1;
  let ch = text2[start];
  while (ch === " " || ch === "	") {
    if (i < start + indent) {
      ch = text2[++i];
    } else {
      do {
        ch = text2[++i];
      } while (ch && ch !== "\n");
      end = i;
      start = i + 1;
      ch = text2[start];
    }
  }
  return end;
}

// node_modules/yaml/browser/dist/stringify/stringifyString.js
var getFoldOptions = (ctx, isBlock2) => ({
  indentAtStart: isBlock2 ? ctx.indent.length : ctx.indentAtStart,
  lineWidth: ctx.options.lineWidth,
  minContentWidth: ctx.options.minContentWidth
});
var containsDocumentMarker = (str6) => /^(%|---|\.\.\.)/m.test(str6);
function lineLengthOverLimit(str6, lineWidth, indentLength) {
  if (!lineWidth || lineWidth < 0)
    return false;
  const limit = lineWidth - indentLength;
  const strLen = str6.length;
  if (strLen <= limit)
    return false;
  for (let i = 0, start = 0; i < strLen; ++i) {
    if (str6[i] === "\n") {
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
  const json2 = JSON.stringify(value);
  if (ctx.options.doubleQuotedAsJSON)
    return json2;
  const { implicitKey } = ctx;
  const minMultiLineLength = ctx.options.doubleQuotedMinMultiLineLength;
  const indent = ctx.indent || (containsDocumentMarker(value) ? "  " : "");
  let str6 = "";
  let start = 0;
  for (let i = 0, ch = json2[i]; ch; ch = json2[++i]) {
    if (ch === " " && json2[i + 1] === "\\" && json2[i + 2] === "n") {
      str6 += json2.slice(start, i) + "\\ ";
      i += 1;
      start = i;
      ch = "\\";
    }
    if (ch === "\\")
      switch (json2[i + 1]) {
        case "u":
          {
            str6 += json2.slice(start, i);
            const code = json2.substr(i + 2, 4);
            switch (code) {
              case "0000":
                str6 += "\\0";
                break;
              case "0007":
                str6 += "\\a";
                break;
              case "000b":
                str6 += "\\v";
                break;
              case "001b":
                str6 += "\\e";
                break;
              case "0085":
                str6 += "\\N";
                break;
              case "00a0":
                str6 += "\\_";
                break;
              case "2028":
                str6 += "\\L";
                break;
              case "2029":
                str6 += "\\P";
                break;
              default:
                if (code.substr(0, 2) === "00")
                  str6 += "\\x" + code.substr(2);
                else
                  str6 += json2.substr(i, 6);
            }
            i += 5;
            start = i + 1;
          }
          break;
        case "n":
          if (implicitKey || json2[i + 2] === '"' || json2.length < minMultiLineLength) {
            i += 1;
          } else {
            str6 += json2.slice(start, i) + "\n\n";
            while (json2[i + 2] === "\\" && json2[i + 3] === "n" && json2[i + 4] !== '"') {
              str6 += "\n";
              i += 2;
            }
            str6 += indent;
            if (json2[i + 2] === " ")
              str6 += "\\";
            i += 1;
            start = i + 1;
          }
          break;
        default:
          i += 1;
      }
  }
  str6 = start ? str6 + json2.slice(start) : json2;
  return implicitKey ? str6 : foldFlowLines(str6, indent, FOLD_QUOTED, getFoldOptions(ctx, false));
}
function singleQuotedString(value, ctx) {
  if (ctx.options.singleQuote === false || ctx.implicitKey && value.includes("\n") || /[ \t]\n|\n[ \t]/.test(value))
    return doubleQuotedString(value, ctx);
  const indent = ctx.indent || (containsDocumentMarker(value) ? "  " : "");
  const res = "'" + value.replace(/'/g, "''").replace(/\n+/g, `$&
${indent}`) + "'";
  return ctx.implicitKey ? res : foldFlowLines(res, indent, FOLD_FLOW, getFoldOptions(ctx, false));
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
  const literal = blockQuote === "literal" ? true : blockQuote === "folded" || type === Scalar.BLOCK_FOLDED ? false : type === Scalar.BLOCK_LITERAL ? true : !lineLengthOverLimit(value, lineWidth, indent.length);
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
    if (blockQuote !== "folded" && type !== Scalar.BLOCK_FOLDED) {
      foldOptions.onOverflow = () => {
        literalFallback = true;
      };
    }
    const body = foldFlowLines(`${start}${foldedValue}${end}`, indent, FOLD_BLOCK, foldOptions);
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
  if (!implicitKey && !inFlow && type !== Scalar.PLAIN && value.includes("\n")) {
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
  const str6 = value.replace(/\n+/g, `$&
${indent}`);
  if (actualString) {
    const test = (tag) => tag.default && tag.tag !== "tag:yaml.org,2002:str" && tag.test?.test(str6);
    const { compat, tags } = ctx.doc.schema;
    if (tags.some(test) || compat?.some(test))
      return quotedString(value, ctx);
  }
  return implicitKey ? str6 : foldFlowLines(str6, indent, FOLD_FLOW, getFoldOptions(ctx, false));
}
function stringifyString(item, ctx, onComment, onChompKeep) {
  const { implicitKey, inFlow } = ctx;
  const ss = typeof item.value === "string" ? item : Object.assign({}, item, { value: String(item.value) });
  let { type } = item;
  if (type !== Scalar.QUOTE_DOUBLE) {
    if (/[\x00-\x08\x0b-\x1f\x7f-\x9f\u{D800}-\u{DFFF}]/u.test(ss.value))
      type = Scalar.QUOTE_DOUBLE;
  }
  const _stringify = (_type) => {
    switch (_type) {
      case Scalar.BLOCK_FOLDED:
      case Scalar.BLOCK_LITERAL:
        return implicitKey || inFlow ? quotedString(ss.value, ctx) : blockString(ss, ctx, onComment, onChompKeep);
      case Scalar.QUOTE_DOUBLE:
        return doubleQuotedString(ss.value, ctx);
      case Scalar.QUOTE_SINGLE:
        return singleQuotedString(ss.value, ctx);
      case Scalar.PLAIN:
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

// node_modules/yaml/browser/dist/stringify/stringify.js
function createStringifyContext(doc, options) {
  const opt = Object.assign({
    blockQuote: true,
    commentString: stringifyComment,
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
  if (isScalar(item)) {
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
function stringifyProps(node, tagObj, { anchors, doc }) {
  if (!doc.directives)
    return "";
  const props = [];
  const anchor = (isScalar(node) || isCollection(node)) && node.anchor;
  if (anchor && anchorIsValid(anchor)) {
    anchors.add(anchor);
    props.push(`&${anchor}`);
  }
  const tag = node.tag ?? (tagObj.default ? null : tagObj.tag);
  if (tag)
    props.push(doc.directives.tagString(tag));
  return props.join(" ");
}
function stringify(item, ctx, onComment, onChompKeep) {
  if (isPair(item))
    return item.toString(ctx, onComment, onChompKeep);
  if (isAlias(item)) {
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
  const node = isNode(item) ? item : ctx.doc.createNode(item, { onTagObj: (o) => tagObj = o });
  tagObj ?? (tagObj = getTagObject(ctx.doc.schema.tags, node));
  const props = stringifyProps(node, tagObj, ctx);
  if (props.length > 0)
    ctx.indentAtStart = (ctx.indentAtStart ?? 0) + props.length + 1;
  const str6 = typeof tagObj.stringify === "function" ? tagObj.stringify(node, ctx, onComment, onChompKeep) : isScalar(node) ? stringifyString(node, ctx, onComment, onChompKeep) : node.toString(ctx, onComment, onChompKeep);
  if (!props)
    return str6;
  return isScalar(node) || str6[0] === "{" || str6[0] === "[" ? `${props} ${str6}` : `${props}
${ctx.indent}${str6}`;
}

// node_modules/yaml/browser/dist/stringify/stringifyPair.js
function stringifyPair({ key, value }, ctx, onComment, onChompKeep) {
  const { allNullValues, doc, indent, indentStep, options: { commentString, indentSeq, simpleKeys } } = ctx;
  let keyComment = isNode(key) && key.comment || null;
  if (simpleKeys) {
    if (keyComment) {
      throw new Error("With simple keys, key nodes cannot have comments");
    }
    if (isCollection(key) || !isNode(key) && typeof key === "object") {
      const msg = "With simple keys, collection cannot be used as a key value";
      throw new Error(msg);
    }
  }
  let explicitKey = !simpleKeys && (!key || keyComment && value == null && !ctx.inFlow || isCollection(key) || (isScalar(key) ? key.type === Scalar.BLOCK_FOLDED || key.type === Scalar.BLOCK_LITERAL : typeof key === "object"));
  ctx = Object.assign({}, ctx, {
    allNullValues: false,
    implicitKey: !explicitKey && (simpleKeys || !allNullValues),
    indent: indent + indentStep
  });
  let keyCommentDone = false;
  let chompKeep = false;
  let str6 = stringify(key, ctx, () => keyCommentDone = true, () => chompKeep = true);
  if (!explicitKey && !ctx.inFlow && str6.length > 1024) {
    if (simpleKeys)
      throw new Error("With simple keys, single line scalar must not span more than 1024 characters");
    explicitKey = true;
  }
  if (ctx.inFlow) {
    if (allNullValues || value == null) {
      if (keyCommentDone && onComment)
        onComment();
      return str6 === "" ? "?" : explicitKey ? `? ${str6}` : str6;
    }
  } else if (allNullValues && !simpleKeys || value == null && explicitKey) {
    str6 = `? ${str6}`;
    if (keyComment && !keyCommentDone) {
      str6 += lineComment(str6, ctx.indent, commentString(keyComment));
    } else if (chompKeep && onChompKeep)
      onChompKeep();
    return str6;
  }
  if (keyCommentDone)
    keyComment = null;
  if (explicitKey) {
    if (keyComment)
      str6 += lineComment(str6, ctx.indent, commentString(keyComment));
    str6 = `? ${str6}
${indent}:`;
  } else {
    str6 = `${str6}:`;
    if (keyComment)
      str6 += lineComment(str6, ctx.indent, commentString(keyComment));
  }
  let vsb, vcb, valueComment;
  if (isNode(value)) {
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
  if (!explicitKey && !keyComment && isScalar(value))
    ctx.indentAtStart = str6.length + 1;
  chompKeep = false;
  if (!indentSeq && indentStep.length >= 2 && !ctx.inFlow && !explicitKey && isSeq(value) && !value.flow && !value.tag && !value.anchor) {
    ctx.indent = ctx.indent.substring(2);
  }
  let valueCommentDone = false;
  const valueStr = stringify(value, ctx, () => valueCommentDone = true, () => chompKeep = true);
  let ws = " ";
  if (keyComment || vsb || vcb) {
    ws = vsb ? "\n" : "";
    if (vcb) {
      const cs = commentString(vcb);
      ws += `
${indentComment(cs, ctx.indent)}`;
    }
    if (valueStr === "" && !ctx.inFlow) {
      if (ws === "\n" && valueComment)
        ws = "\n\n";
    } else {
      ws += `
${ctx.indent}`;
    }
  } else if (!explicitKey && isCollection(value)) {
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
  str6 += ws + valueStr;
  if (ctx.inFlow) {
    if (valueCommentDone && onComment)
      onComment();
  } else if (valueComment && !valueCommentDone) {
    str6 += lineComment(str6, ctx.indent, commentString(valueComment));
  } else if (chompKeep && onChompKeep) {
    onChompKeep();
  }
  return str6;
}

// node_modules/yaml/browser/dist/log.js
function warn(logLevel, warning) {
  if (logLevel === "debug" || logLevel === "warn") {
    console.warn(warning);
  }
}

// node_modules/yaml/browser/dist/schema/yaml-1.1/merge.js
var MERGE_KEY = "<<";
var merge = {
  identify: (value) => value === MERGE_KEY || typeof value === "symbol" && value.description === MERGE_KEY,
  default: "key",
  tag: "tag:yaml.org,2002:merge",
  test: /^<<$/,
  resolve: () => Object.assign(new Scalar(Symbol(MERGE_KEY)), {
    addToJSMap: addMergeToJSMap
  }),
  stringify: () => MERGE_KEY
};
var isMergeKey = (ctx, key) => (merge.identify(key) || isScalar(key) && (!key.type || key.type === Scalar.PLAIN) && merge.identify(key.value)) && ctx?.doc.schema.tags.some((tag) => tag.tag === merge.tag && tag.default);
function addMergeToJSMap(ctx, map2, value) {
  const source = resolveAliasValue(ctx, value);
  if (isSeq(source))
    for (const it of source.items)
      mergeValue(ctx, map2, it);
  else if (Array.isArray(source))
    for (const it of source)
      mergeValue(ctx, map2, it);
  else
    mergeValue(ctx, map2, source);
}
function mergeValue(ctx, map2, value) {
  const source = resolveAliasValue(ctx, value);
  if (!isMap(source))
    throw new Error("Merge sources must be maps or map aliases");
  const srcMap = source.toJSON(null, ctx, Map);
  for (const [key, value2] of srcMap) {
    if (map2 instanceof Map) {
      if (!map2.has(key))
        map2.set(key, value2);
    } else if (map2 instanceof Set) {
      map2.add(key);
    } else if (!Object.prototype.hasOwnProperty.call(map2, key)) {
      Object.defineProperty(map2, key, {
        value: value2,
        writable: true,
        enumerable: true,
        configurable: true
      });
    }
  }
  return map2;
}
function resolveAliasValue(ctx, value) {
  return ctx && isAlias(value) ? value.resolve(ctx.doc, ctx) : value;
}

// node_modules/yaml/browser/dist/nodes/addPairToJSMap.js
function addPairToJSMap(ctx, map2, { key, value }) {
  if (isNode(key) && key.addToJSMap)
    key.addToJSMap(ctx, map2, value);
  else if (isMergeKey(ctx, key))
    addMergeToJSMap(ctx, map2, value);
  else {
    const jsKey = toJS(key, "", ctx);
    if (map2 instanceof Map) {
      map2.set(jsKey, toJS(value, jsKey, ctx));
    } else if (map2 instanceof Set) {
      map2.add(jsKey);
    } else {
      const stringKey = stringifyKey(key, jsKey, ctx);
      const jsValue = toJS(value, stringKey, ctx);
      if (stringKey in map2)
        Object.defineProperty(map2, stringKey, {
          value: jsValue,
          writable: true,
          enumerable: true,
          configurable: true
        });
      else
        map2[stringKey] = jsValue;
    }
  }
  return map2;
}
function stringifyKey(key, jsKey, ctx) {
  if (jsKey === null)
    return "";
  if (typeof jsKey !== "object")
    return String(jsKey);
  if (isNode(key) && ctx?.doc) {
    const strCtx = createStringifyContext(ctx.doc, {});
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
      warn(ctx.doc.options.logLevel, `Keys with collection values will be stringified due to JS Object restrictions: ${jsonStr}. Set mapAsMap: true to use object keys.`);
      ctx.mapKeyWarned = true;
    }
    return strKey;
  }
  return JSON.stringify(jsKey);
}

// node_modules/yaml/browser/dist/nodes/Pair.js
function createPair(key, value, ctx) {
  const k = createNode(key, void 0, ctx);
  const v = createNode(value, void 0, ctx);
  return new Pair(k, v);
}
var Pair = class _Pair {
  constructor(key, value = null) {
    Object.defineProperty(this, NODE_TYPE, { value: PAIR });
    this.key = key;
    this.value = value;
  }
  clone(schema4) {
    let { key, value } = this;
    if (isNode(key))
      key = key.clone(schema4);
    if (isNode(value))
      value = value.clone(schema4);
    return new _Pair(key, value);
  }
  toJSON(_, ctx) {
    const pair = ctx?.mapAsMap ? /* @__PURE__ */ new Map() : {};
    return addPairToJSMap(ctx, pair, this);
  }
  toString(ctx, onComment, onChompKeep) {
    return ctx?.doc ? stringifyPair(this, ctx, onComment, onChompKeep) : JSON.stringify(this);
  }
};

// node_modules/yaml/browser/dist/stringify/stringifyCollection.js
function stringifyCollection(collection, ctx, options) {
  const flow = ctx.inFlow ?? collection.flow;
  const stringify4 = flow ? stringifyFlowCollection : stringifyBlockCollection;
  return stringify4(collection, ctx, options);
}
function stringifyBlockCollection({ comment, items }, ctx, { blockItemPrefix, flowChars, itemIndent, onChompKeep, onComment }) {
  const { indent, options: { commentString } } = ctx;
  const itemCtx = Object.assign({}, ctx, { indent: itemIndent, type: null });
  let chompKeep = false;
  const lines = [];
  for (let i = 0; i < items.length; ++i) {
    const item = items[i];
    let comment2 = null;
    if (isNode(item)) {
      if (!chompKeep && item.spaceBefore)
        lines.push("");
      addCommentBefore(ctx, lines, item.commentBefore, chompKeep);
      if (item.comment)
        comment2 = item.comment;
    } else if (isPair(item)) {
      const ik = isNode(item.key) ? item.key : null;
      if (ik) {
        if (!chompKeep && ik.spaceBefore)
          lines.push("");
        addCommentBefore(ctx, lines, ik.commentBefore, chompKeep);
      }
    }
    chompKeep = false;
    let str7 = stringify(item, itemCtx, () => comment2 = null, () => chompKeep = true);
    if (comment2)
      str7 += lineComment(str7, itemIndent, commentString(comment2));
    if (chompKeep && comment2)
      chompKeep = false;
    lines.push(blockItemPrefix + str7);
  }
  let str6;
  if (lines.length === 0) {
    str6 = flowChars.start + flowChars.end;
  } else {
    str6 = lines[0];
    for (let i = 1; i < lines.length; ++i) {
      const line = lines[i];
      str6 += line ? `
${indent}${line}` : "\n";
    }
  }
  if (comment) {
    str6 += "\n" + indentComment(commentString(comment), indent);
    if (onComment)
      onComment();
  } else if (chompKeep && onChompKeep)
    onChompKeep();
  return str6;
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
    if (isNode(item)) {
      if (item.spaceBefore)
        lines.push("");
      addCommentBefore(ctx, lines, item.commentBefore, false);
      if (item.comment)
        comment = item.comment;
    } else if (isPair(item)) {
      const ik = isNode(item.key) ? item.key : null;
      if (ik) {
        if (ik.spaceBefore)
          lines.push("");
        addCommentBefore(ctx, lines, ik.commentBefore, false);
        if (ik.comment)
          reqNewline = true;
      }
      const iv = isNode(item.value) ? item.value : null;
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
    let str6 = stringify(item, itemCtx, () => comment = null);
    reqNewline || (reqNewline = lines.length > linesAtValue || str6.includes("\n"));
    if (i < items.length - 1) {
      str6 += ",";
    } else if (ctx.options.trailingComma) {
      if (ctx.options.lineWidth > 0) {
        reqNewline || (reqNewline = lines.reduce((sum, line) => sum + line.length + 2, 2) + (str6.length + 2) > ctx.options.lineWidth);
      }
      if (reqNewline) {
        str6 += ",";
      }
    }
    if (comment)
      str6 += lineComment(str6, itemIndent, commentString(comment));
    lines.push(str6);
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
      let str6 = start;
      for (const line of lines)
        str6 += line ? `
${indentStep}${indent}${line}` : "\n";
      return `${str6}
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
    const ic = indentComment(commentString(comment), indent);
    lines.push(ic.trimStart());
  }
}

// node_modules/yaml/browser/dist/nodes/YAMLMap.js
function findPair(items, key) {
  const k = isScalar(key) ? key.value : key;
  for (const it of items) {
    if (isPair(it)) {
      if (it.key === key || it.key === k)
        return it;
      if (isScalar(it.key) && it.key.value === k)
        return it;
    }
  }
  return void 0;
}
var YAMLMap = class extends Collection {
  static get tagName() {
    return "tag:yaml.org,2002:map";
  }
  constructor(schema4) {
    super(MAP, schema4);
    this.items = [];
  }
  /**
   * A generic collection parsing method that can be extended
   * to other node classes that inherit from YAMLMap
   */
  static from(schema4, obj, ctx) {
    const { keepUndefined, replacer } = ctx;
    const map2 = new this(schema4);
    const add = (key, value) => {
      if (typeof replacer === "function")
        value = replacer.call(obj, key, value);
      else if (Array.isArray(replacer) && !replacer.includes(key))
        return;
      if (value !== void 0 || keepUndefined)
        map2.items.push(createPair(key, value, ctx));
    };
    if (obj instanceof Map) {
      for (const [key, value] of obj)
        add(key, value);
    } else if (obj && typeof obj === "object") {
      for (const key of Object.keys(obj))
        add(key, obj[key]);
    }
    if (typeof schema4.sortMapEntries === "function") {
      map2.items.sort(schema4.sortMapEntries);
    }
    return map2;
  }
  /**
   * Adds a value to the collection.
   *
   * @param overwrite - If not set `true`, using a key that is already in the
   *   collection will throw. Otherwise, overwrites the previous value.
   */
  add(pair, overwrite) {
    let _pair;
    if (isPair(pair))
      _pair = pair;
    else if (!pair || typeof pair !== "object" || !("key" in pair)) {
      _pair = new Pair(pair, pair?.value);
    } else
      _pair = new Pair(pair.key, pair.value);
    const prev = findPair(this.items, _pair.key);
    const sortEntries = this.schema?.sortMapEntries;
    if (prev) {
      if (!overwrite)
        throw new Error(`Key ${_pair.key} already set`);
      if (isScalar(prev.value) && isScalarValue(_pair.value))
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
    return (!keepScalar && isScalar(node) ? node.value : node) ?? void 0;
  }
  has(key) {
    return !!findPair(this.items, key);
  }
  set(key, value) {
    this.add(new Pair(key, value), true);
  }
  /**
   * @param ctx - Conversion context, originally set in Document#toJS()
   * @param {Class} Type - If set, forces the returned collection type
   * @returns Instance of Type, Map, or Object
   */
  toJSON(_, ctx, Type) {
    const map2 = Type ? new Type() : ctx?.mapAsMap ? /* @__PURE__ */ new Map() : {};
    if (ctx?.onCreate)
      ctx.onCreate(map2);
    for (const item of this.items)
      addPairToJSMap(ctx, map2, item);
    return map2;
  }
  toString(ctx, onComment, onChompKeep) {
    if (!ctx)
      return JSON.stringify(this);
    for (const item of this.items) {
      if (!isPair(item))
        throw new Error(`Map items must all be pairs; found ${JSON.stringify(item)} instead`);
    }
    if (!ctx.allNullValues && this.hasAllNullValues(false))
      ctx = Object.assign({}, ctx, { allNullValues: true });
    return stringifyCollection(this, ctx, {
      blockItemPrefix: "",
      flowChars: { start: "{", end: "}" },
      itemIndent: ctx.indent || "",
      onChompKeep,
      onComment
    });
  }
};

// node_modules/yaml/browser/dist/schema/common/map.js
var map = {
  collection: "map",
  default: true,
  nodeClass: YAMLMap,
  tag: "tag:yaml.org,2002:map",
  resolve(map2, onError) {
    if (!isMap(map2))
      onError("Expected a mapping for this tag");
    return map2;
  },
  createNode: (schema4, obj, ctx) => YAMLMap.from(schema4, obj, ctx)
};

// node_modules/yaml/browser/dist/nodes/YAMLSeq.js
var YAMLSeq = class extends Collection {
  static get tagName() {
    return "tag:yaml.org,2002:seq";
  }
  constructor(schema4) {
    super(SEQ, schema4);
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
    return !keepScalar && isScalar(it) ? it.value : it;
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
    if (isScalar(prev) && isScalarValue(value))
      prev.value = value;
    else
      this.items[idx] = value;
  }
  toJSON(_, ctx) {
    const seq2 = [];
    if (ctx?.onCreate)
      ctx.onCreate(seq2);
    let i = 0;
    for (const item of this.items)
      seq2.push(toJS(item, String(i++), ctx));
    return seq2;
  }
  toString(ctx, onComment, onChompKeep) {
    if (!ctx)
      return JSON.stringify(this);
    return stringifyCollection(this, ctx, {
      blockItemPrefix: "- ",
      flowChars: { start: "[", end: "]" },
      itemIndent: (ctx.indent || "") + "  ",
      onChompKeep,
      onComment
    });
  }
  static from(schema4, obj, ctx) {
    const { replacer } = ctx;
    const seq2 = new this(schema4);
    if (obj && Symbol.iterator in Object(obj)) {
      let i = 0;
      for (let it of obj) {
        if (typeof replacer === "function") {
          const key = obj instanceof Set ? it : String(i++);
          it = replacer.call(obj, key, it);
        }
        seq2.items.push(createNode(it, void 0, ctx));
      }
    }
    return seq2;
  }
};
function asItemIndex(key) {
  let idx = isScalar(key) ? key.value : key;
  if (idx && typeof idx === "string")
    idx = Number(idx);
  return typeof idx === "number" && Number.isInteger(idx) && idx >= 0 ? idx : null;
}

// node_modules/yaml/browser/dist/schema/common/seq.js
var seq = {
  collection: "seq",
  default: true,
  nodeClass: YAMLSeq,
  tag: "tag:yaml.org,2002:seq",
  resolve(seq2, onError) {
    if (!isSeq(seq2))
      onError("Expected a sequence for this tag");
    return seq2;
  },
  createNode: (schema4, obj, ctx) => YAMLSeq.from(schema4, obj, ctx)
};

// node_modules/yaml/browser/dist/schema/common/string.js
var string = {
  identify: (value) => typeof value === "string",
  default: true,
  tag: "tag:yaml.org,2002:str",
  resolve: (str6) => str6,
  stringify(item, ctx, onComment, onChompKeep) {
    ctx = Object.assign({ actualString: true }, ctx);
    return stringifyString(item, ctx, onComment, onChompKeep);
  }
};

// node_modules/yaml/browser/dist/schema/common/null.js
var nullTag = {
  identify: (value) => value == null,
  createNode: () => new Scalar(null),
  default: true,
  tag: "tag:yaml.org,2002:null",
  test: /^(?:~|[Nn]ull|NULL)?$/,
  resolve: () => new Scalar(null),
  stringify: ({ source }, ctx) => typeof source === "string" && nullTag.test.test(source) ? source : ctx.options.nullStr
};

// node_modules/yaml/browser/dist/schema/core/bool.js
var boolTag = {
  identify: (value) => typeof value === "boolean",
  default: true,
  tag: "tag:yaml.org,2002:bool",
  test: /^(?:[Tt]rue|TRUE|[Ff]alse|FALSE)$/,
  resolve: (str6) => new Scalar(str6[0] === "t" || str6[0] === "T"),
  stringify({ source, value }, ctx) {
    if (source && boolTag.test.test(source)) {
      const sv = source[0] === "t" || source[0] === "T";
      if (value === sv)
        return source;
    }
    return value ? ctx.options.trueStr : ctx.options.falseStr;
  }
};

// node_modules/yaml/browser/dist/stringify/stringifyNumber.js
function stringifyNumber({ format, minFractionDigits, tag, value }) {
  if (typeof value === "bigint")
    return String(value);
  const num3 = typeof value === "number" ? value : Number(value);
  if (!isFinite(num3))
    return isNaN(num3) ? ".nan" : num3 < 0 ? "-.inf" : ".inf";
  let n2 = Object.is(value, -0) ? "-0" : JSON.stringify(value);
  if (!format && minFractionDigits && (!tag || tag === "tag:yaml.org,2002:float") && /^-?\d/.test(n2) && !n2.includes("e")) {
    let i = n2.indexOf(".");
    if (i < 0) {
      i = n2.length;
      n2 += ".";
    }
    let d = minFractionDigits - (n2.length - i - 1);
    while (d-- > 0)
      n2 += "0";
  }
  return n2;
}

// node_modules/yaml/browser/dist/schema/core/float.js
var floatNaN = {
  identify: (value) => typeof value === "number",
  default: true,
  tag: "tag:yaml.org,2002:float",
  test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
  resolve: (str6) => str6.slice(-3).toLowerCase() === "nan" ? NaN : str6[0] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
  stringify: stringifyNumber
};
var floatExp = {
  identify: (value) => typeof value === "number",
  default: true,
  tag: "tag:yaml.org,2002:float",
  format: "EXP",
  test: /^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)[eE][-+]?[0-9]+$/,
  resolve: (str6) => parseFloat(str6),
  stringify(node) {
    const num3 = Number(node.value);
    return isFinite(num3) ? num3.toExponential() : stringifyNumber(node);
  }
};
var float = {
  identify: (value) => typeof value === "number",
  default: true,
  tag: "tag:yaml.org,2002:float",
  test: /^[-+]?(?:\.[0-9]+|[0-9]+\.[0-9]*)$/,
  resolve(str6) {
    const node = new Scalar(parseFloat(str6));
    const dot = str6.indexOf(".");
    if (dot !== -1 && str6[str6.length - 1] === "0")
      node.minFractionDigits = str6.length - dot - 1;
    return node;
  },
  stringify: stringifyNumber
};

// node_modules/yaml/browser/dist/schema/core/int.js
var intIdentify = (value) => typeof value === "bigint" || Number.isInteger(value);
var intResolve = (str6, offset, radix, { intAsBigInt }) => intAsBigInt ? BigInt(str6) : parseInt(str6.substring(offset), radix);
function intStringify(node, radix, prefix) {
  const { value } = node;
  if (intIdentify(value) && value >= 0)
    return prefix + value.toString(radix);
  return stringifyNumber(node);
}
var intOct = {
  identify: (value) => intIdentify(value) && value >= 0,
  default: true,
  tag: "tag:yaml.org,2002:int",
  format: "OCT",
  test: /^0o[0-7]+$/,
  resolve: (str6, _onError, opt) => intResolve(str6, 2, 8, opt),
  stringify: (node) => intStringify(node, 8, "0o")
};
var int = {
  identify: intIdentify,
  default: true,
  tag: "tag:yaml.org,2002:int",
  test: /^[-+]?[0-9]+$/,
  resolve: (str6, _onError, opt) => intResolve(str6, 0, 10, opt),
  stringify: stringifyNumber
};
var intHex = {
  identify: (value) => intIdentify(value) && value >= 0,
  default: true,
  tag: "tag:yaml.org,2002:int",
  format: "HEX",
  test: /^0x[0-9a-fA-F]+$/,
  resolve: (str6, _onError, opt) => intResolve(str6, 2, 16, opt),
  stringify: (node) => intStringify(node, 16, "0x")
};

// node_modules/yaml/browser/dist/schema/core/schema.js
var schema = [
  map,
  seq,
  string,
  nullTag,
  boolTag,
  intOct,
  int,
  intHex,
  floatNaN,
  floatExp,
  float
];

// node_modules/yaml/browser/dist/schema/json/schema.js
function intIdentify2(value) {
  return typeof value === "bigint" || Number.isInteger(value);
}
var stringifyJSON = ({ value }) => JSON.stringify(value);
var jsonScalars = [
  {
    identify: (value) => typeof value === "string",
    default: true,
    tag: "tag:yaml.org,2002:str",
    resolve: (str6) => str6,
    stringify: stringifyJSON
  },
  {
    identify: (value) => value == null,
    createNode: () => new Scalar(null),
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
    resolve: (str6) => str6 === "true",
    stringify: stringifyJSON
  },
  {
    identify: intIdentify2,
    default: true,
    tag: "tag:yaml.org,2002:int",
    test: /^-?(?:0|[1-9][0-9]*)$/,
    resolve: (str6, _onError, { intAsBigInt }) => intAsBigInt ? BigInt(str6) : parseInt(str6, 10),
    stringify: ({ value }) => intIdentify2(value) ? value.toString() : JSON.stringify(value)
  },
  {
    identify: (value) => typeof value === "number",
    default: true,
    tag: "tag:yaml.org,2002:float",
    test: /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*)?(?:[eE][-+]?[0-9]+)?$/,
    resolve: (str6) => parseFloat(str6),
    stringify: stringifyJSON
  }
];
var jsonError = {
  default: true,
  tag: "",
  test: /^/,
  resolve(str6, onError) {
    onError(`Unresolved plain scalar ${JSON.stringify(str6)}`);
    return str6;
  }
};
var schema2 = [map, seq].concat(jsonScalars, jsonError);

// node_modules/yaml/browser/dist/schema/yaml-1.1/binary.js
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
    if (typeof atob === "function") {
      const str6 = atob(src.replace(/[\n\r]/g, ""));
      const buffer = new Uint8Array(str6.length);
      for (let i = 0; i < str6.length; ++i)
        buffer[i] = str6.charCodeAt(i);
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
    let str6;
    if (typeof btoa === "function") {
      let s = "";
      for (let i = 0; i < buf.length; ++i)
        s += String.fromCharCode(buf[i]);
      str6 = btoa(s);
    } else {
      throw new Error("This environment does not support writing binary tags; either Buffer or btoa is required");
    }
    type ?? (type = Scalar.BLOCK_LITERAL);
    if (type !== Scalar.QUOTE_DOUBLE) {
      const lineWidth = Math.max(ctx.options.lineWidth - ctx.indent.length, ctx.options.minContentWidth);
      const n2 = Math.ceil(str6.length / lineWidth);
      const lines = new Array(n2);
      for (let i = 0, o = 0; i < n2; ++i, o += lineWidth) {
        lines[i] = str6.substr(o, lineWidth);
      }
      str6 = lines.join(type === Scalar.BLOCK_LITERAL ? "\n" : " ");
    }
    return stringifyString({ comment, type, value: str6 }, ctx, onComment, onChompKeep);
  }
};

// node_modules/yaml/browser/dist/schema/yaml-1.1/pairs.js
function resolvePairs(seq2, onError) {
  if (isSeq(seq2)) {
    for (let i = 0; i < seq2.items.length; ++i) {
      let item = seq2.items[i];
      if (isPair(item))
        continue;
      else if (isMap(item)) {
        if (item.items.length > 1)
          onError("Each pair must have its own sequence indicator");
        const pair = item.items[0] || new Pair(new Scalar(null));
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
      seq2.items[i] = isPair(item) ? item : new Pair(item);
    }
  } else
    onError("Expected a sequence for this tag");
  return seq2;
}
function createPairs(schema4, iterable, ctx) {
  const { replacer } = ctx;
  const pairs2 = new YAMLSeq(schema4);
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
      pairs2.items.push(createPair(key, value, ctx));
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

// node_modules/yaml/browser/dist/schema/yaml-1.1/omap.js
var YAMLOMap = class _YAMLOMap extends YAMLSeq {
  constructor() {
    super();
    this.add = YAMLMap.prototype.add.bind(this);
    this.delete = YAMLMap.prototype.delete.bind(this);
    this.get = YAMLMap.prototype.get.bind(this);
    this.has = YAMLMap.prototype.has.bind(this);
    this.set = YAMLMap.prototype.set.bind(this);
    this.tag = _YAMLOMap.tag;
  }
  /**
   * If `ctx` is given, the return type is actually `Map<unknown, unknown>`,
   * but TypeScript won't allow widening the signature of a child method.
   */
  toJSON(_, ctx) {
    if (!ctx)
      return super.toJSON(_);
    const map2 = /* @__PURE__ */ new Map();
    if (ctx?.onCreate)
      ctx.onCreate(map2);
    for (const pair of this.items) {
      let key, value;
      if (isPair(pair)) {
        key = toJS(pair.key, "", ctx);
        value = toJS(pair.value, key, ctx);
      } else {
        key = toJS(pair, "", ctx);
      }
      if (map2.has(key))
        throw new Error("Ordered maps must not include duplicate keys");
      map2.set(key, value);
    }
    return map2;
  }
  static from(schema4, iterable, ctx) {
    const pairs2 = createPairs(schema4, iterable, ctx);
    const omap2 = new this();
    omap2.items = pairs2.items;
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
  resolve(seq2, onError) {
    const pairs2 = resolvePairs(seq2, onError);
    const seenKeys = [];
    for (const { key } of pairs2.items) {
      if (isScalar(key)) {
        if (seenKeys.includes(key.value)) {
          onError(`Ordered maps must not include duplicate keys: ${key.value}`);
        } else {
          seenKeys.push(key.value);
        }
      }
    }
    return Object.assign(new YAMLOMap(), pairs2);
  },
  createNode: (schema4, iterable, ctx) => YAMLOMap.from(schema4, iterable, ctx)
};

// node_modules/yaml/browser/dist/schema/yaml-1.1/bool.js
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
  resolve: () => new Scalar(true),
  stringify: boolStringify
};
var falseTag = {
  identify: (value) => value === false,
  default: true,
  tag: "tag:yaml.org,2002:bool",
  test: /^(?:N|n|[Nn]o|NO|[Ff]alse|FALSE|[Oo]ff|OFF)$/,
  resolve: () => new Scalar(false),
  stringify: boolStringify
};

// node_modules/yaml/browser/dist/schema/yaml-1.1/float.js
var floatNaN2 = {
  identify: (value) => typeof value === "number",
  default: true,
  tag: "tag:yaml.org,2002:float",
  test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
  resolve: (str6) => str6.slice(-3).toLowerCase() === "nan" ? NaN : str6[0] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
  stringify: stringifyNumber
};
var floatExp2 = {
  identify: (value) => typeof value === "number",
  default: true,
  tag: "tag:yaml.org,2002:float",
  format: "EXP",
  test: /^[-+]?(?:[0-9][0-9_]*)?(?:\.[0-9_]*)?[eE][-+]?[0-9]+$/,
  resolve: (str6) => parseFloat(str6.replace(/_/g, "")),
  stringify(node) {
    const num3 = Number(node.value);
    return isFinite(num3) ? num3.toExponential() : stringifyNumber(node);
  }
};
var float2 = {
  identify: (value) => typeof value === "number",
  default: true,
  tag: "tag:yaml.org,2002:float",
  test: /^[-+]?(?:[0-9][0-9_]*)?\.[0-9_]*$/,
  resolve(str6) {
    const node = new Scalar(parseFloat(str6.replace(/_/g, "")));
    const dot = str6.indexOf(".");
    if (dot !== -1) {
      const f = str6.substring(dot + 1).replace(/_/g, "");
      if (f[f.length - 1] === "0")
        node.minFractionDigits = f.length;
    }
    return node;
  },
  stringify: stringifyNumber
};

// node_modules/yaml/browser/dist/schema/yaml-1.1/int.js
var intIdentify3 = (value) => typeof value === "bigint" || Number.isInteger(value);
function intResolve2(str6, offset, radix, { intAsBigInt }) {
  const sign = str6[0];
  if (sign === "-" || sign === "+")
    offset += 1;
  str6 = str6.substring(offset).replace(/_/g, "");
  if (intAsBigInt) {
    switch (radix) {
      case 2:
        str6 = `0b${str6}`;
        break;
      case 8:
        str6 = `0o${str6}`;
        break;
      case 16:
        str6 = `0x${str6}`;
        break;
    }
    const n3 = BigInt(str6);
    return sign === "-" ? BigInt(-1) * n3 : n3;
  }
  const n2 = parseInt(str6, radix);
  return sign === "-" ? -1 * n2 : n2;
}
function intStringify2(node, radix, prefix) {
  const { value } = node;
  if (intIdentify3(value)) {
    const str6 = value.toString(radix);
    return value < 0 ? "-" + prefix + str6.substr(1) : prefix + str6;
  }
  return stringifyNumber(node);
}
var intBin = {
  identify: intIdentify3,
  default: true,
  tag: "tag:yaml.org,2002:int",
  format: "BIN",
  test: /^[-+]?0b[0-1_]+$/,
  resolve: (str6, _onError, opt) => intResolve2(str6, 2, 2, opt),
  stringify: (node) => intStringify2(node, 2, "0b")
};
var intOct2 = {
  identify: intIdentify3,
  default: true,
  tag: "tag:yaml.org,2002:int",
  format: "OCT",
  test: /^[-+]?0[0-7_]+$/,
  resolve: (str6, _onError, opt) => intResolve2(str6, 1, 8, opt),
  stringify: (node) => intStringify2(node, 8, "0")
};
var int2 = {
  identify: intIdentify3,
  default: true,
  tag: "tag:yaml.org,2002:int",
  test: /^[-+]?[0-9][0-9_]*$/,
  resolve: (str6, _onError, opt) => intResolve2(str6, 0, 10, opt),
  stringify: stringifyNumber
};
var intHex2 = {
  identify: intIdentify3,
  default: true,
  tag: "tag:yaml.org,2002:int",
  format: "HEX",
  test: /^[-+]?0x[0-9a-fA-F_]+$/,
  resolve: (str6, _onError, opt) => intResolve2(str6, 2, 16, opt),
  stringify: (node) => intStringify2(node, 16, "0x")
};

// node_modules/yaml/browser/dist/schema/yaml-1.1/set.js
var YAMLSet = class _YAMLSet extends YAMLMap {
  constructor(schema4) {
    super(schema4);
    this.tag = _YAMLSet.tag;
  }
  add(key) {
    let pair;
    if (isPair(key))
      pair = key;
    else if (key && typeof key === "object" && "key" in key && "value" in key && key.value === null)
      pair = new Pair(key.key, null);
    else
      pair = new Pair(key, null);
    const prev = findPair(this.items, pair.key);
    if (!prev)
      this.items.push(pair);
  }
  /**
   * If `keepPair` is `true`, returns the Pair matching `key`.
   * Otherwise, returns the value of that Pair's key.
   */
  get(key, keepPair) {
    const pair = findPair(this.items, key);
    return !keepPair && isPair(pair) ? isScalar(pair.key) ? pair.key.value : pair.key : pair;
  }
  set(key, value) {
    if (typeof value !== "boolean")
      throw new Error(`Expected boolean value for set(key, value) in a YAML set, not ${typeof value}`);
    const prev = findPair(this.items, key);
    if (prev && !value) {
      this.items.splice(this.items.indexOf(prev), 1);
    } else if (!prev && value) {
      this.items.push(new Pair(key));
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
  static from(schema4, iterable, ctx) {
    const { replacer } = ctx;
    const set2 = new this(schema4);
    if (iterable && Symbol.iterator in Object(iterable))
      for (let value of iterable) {
        if (typeof replacer === "function")
          value = replacer.call(iterable, value, value);
        set2.items.push(createPair(value, null, ctx));
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
  createNode: (schema4, iterable, ctx) => YAMLSet.from(schema4, iterable, ctx),
  resolve(map2, onError) {
    if (isMap(map2)) {
      if (map2.hasAllNullValues(true))
        return Object.assign(new YAMLSet(), map2);
      else
        onError("Set items must all have null values");
    } else
      onError("Expected a mapping for this tag");
    return map2;
  }
};

// node_modules/yaml/browser/dist/schema/yaml-1.1/timestamp.js
function parseSexagesimal(str6, asBigInt) {
  const sign = str6[0];
  const parts = sign === "-" || sign === "+" ? str6.substring(1) : str6;
  const num3 = (n2) => asBigInt ? BigInt(n2) : Number(n2);
  const res = parts.replace(/_/g, "").split(":").reduce((res2, p) => res2 * num3(60) + num3(p), num3(0));
  return sign === "-" ? num3(-1) * res : res;
}
function stringifySexagesimal(node) {
  let { value } = node;
  let num3 = (n2) => n2;
  if (typeof value === "bigint")
    num3 = (n2) => BigInt(n2);
  else if (isNaN(value) || !isFinite(value))
    return stringifyNumber(node);
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
  return sign + parts.map((n2) => String(n2).padStart(2, "0")).join(":").replace(/000000\d*$/, "");
}
var intTime = {
  identify: (value) => typeof value === "bigint" || Number.isInteger(value),
  default: true,
  tag: "tag:yaml.org,2002:int",
  format: "TIME",
  test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+$/,
  resolve: (str6, _onError, { intAsBigInt }) => parseSexagesimal(str6, intAsBigInt),
  stringify: stringifySexagesimal
};
var floatTime = {
  identify: (value) => typeof value === "number",
  default: true,
  tag: "tag:yaml.org,2002:float",
  format: "TIME",
  test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*$/,
  resolve: (str6) => parseSexagesimal(str6, false),
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
  resolve(str6) {
    const match = str6.match(timestamp.test);
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

// node_modules/yaml/browser/dist/schema/yaml-1.1/schema.js
var schema3 = [
  map,
  seq,
  string,
  nullTag,
  trueTag,
  falseTag,
  intBin,
  intOct2,
  int2,
  intHex2,
  floatNaN2,
  floatExp2,
  float2,
  binary,
  merge,
  omap,
  pairs,
  set,
  intTime,
  floatTime,
  timestamp
];

// node_modules/yaml/browser/dist/schema/tags.js
var schemas = /* @__PURE__ */ new Map([
  ["core", schema],
  ["failsafe", [map, seq, string]],
  ["json", schema2],
  ["yaml11", schema3],
  ["yaml-1.1", schema3]
]);
var tagsByName = {
  binary,
  bool: boolTag,
  float,
  floatExp,
  floatNaN,
  floatTime,
  int,
  intHex,
  intOct,
  intTime,
  map,
  merge,
  null: nullTag,
  omap,
  pairs,
  seq,
  set,
  timestamp
};
var coreKnownTags = {
  "tag:yaml.org,2002:binary": binary,
  "tag:yaml.org,2002:merge": merge,
  "tag:yaml.org,2002:omap": omap,
  "tag:yaml.org,2002:pairs": pairs,
  "tag:yaml.org,2002:set": set,
  "tag:yaml.org,2002:timestamp": timestamp
};
function getTags(customTags, schemaName, addMergeTag) {
  const schemaTags = schemas.get(schemaName);
  if (schemaTags && !customTags) {
    return addMergeTag && !schemaTags.includes(merge) ? schemaTags.concat(merge) : schemaTags.slice();
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
    tags = tags.concat(merge);
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

// node_modules/yaml/browser/dist/schema/Schema.js
var sortMapEntriesByKey = (a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
var Schema = class _Schema {
  constructor({ compat, customTags, merge: merge2, resolveKnownTags, schema: schema4, sortMapEntries, toStringDefaults }) {
    this.compat = Array.isArray(compat) ? getTags(compat, "compat") : compat ? getTags(null, compat) : null;
    this.name = typeof schema4 === "string" && schema4 || "core";
    this.knownTags = resolveKnownTags ? coreKnownTags : {};
    this.tags = getTags(customTags, this.name, merge2);
    this.toStringOptions = toStringDefaults ?? null;
    Object.defineProperty(this, MAP, { value: map });
    Object.defineProperty(this, SCALAR, { value: string });
    Object.defineProperty(this, SEQ, { value: seq });
    this.sortMapEntries = typeof sortMapEntries === "function" ? sortMapEntries : sortMapEntries === true ? sortMapEntriesByKey : null;
  }
  clone() {
    const copy = Object.create(_Schema.prototype, Object.getOwnPropertyDescriptors(this));
    copy.tags = this.tags.slice();
    return copy;
  }
};

// node_modules/yaml/browser/dist/stringify/stringifyDocument.js
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
  const ctx = createStringifyContext(doc, options);
  const { commentString } = ctx.options;
  if (doc.commentBefore) {
    if (lines.length !== 1)
      lines.unshift("");
    const cs = commentString(doc.commentBefore);
    lines.unshift(indentComment(cs, ""));
  }
  let chompKeep = false;
  let contentComment = null;
  if (doc.contents) {
    if (isNode(doc.contents)) {
      if (doc.contents.spaceBefore && hasDirectives)
        lines.push("");
      if (doc.contents.commentBefore) {
        const cs = commentString(doc.contents.commentBefore);
        lines.push(indentComment(cs, ""));
      }
      ctx.forceBlockIndent = !!doc.comment;
      contentComment = doc.contents.comment;
    }
    const onChompKeep = contentComment ? void 0 : () => chompKeep = true;
    let body = stringify(doc.contents, ctx, () => contentComment = null, onChompKeep);
    if (contentComment)
      body += lineComment(body, "", commentString(contentComment));
    if ((body[0] === "|" || body[0] === ">") && lines[lines.length - 1] === "---") {
      lines[lines.length - 1] = `--- ${body}`;
    } else
      lines.push(body);
  } else {
    lines.push(stringify(doc.contents, ctx));
  }
  if (doc.directives?.docEnd) {
    if (doc.comment) {
      const cs = commentString(doc.comment);
      if (cs.includes("\n")) {
        lines.push("...");
        lines.push(indentComment(cs, ""));
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
      lines.push(indentComment(commentString(dc), ""));
    }
  }
  return lines.join("\n") + "\n";
}

// node_modules/yaml/browser/dist/doc/Document.js
var Document = class _Document {
  constructor(value, replacer, options) {
    this.commentBefore = null;
    this.comment = null;
    this.errors = [];
    this.warnings = [];
    Object.defineProperty(this, NODE_TYPE, { value: DOC });
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
      this.directives = new Directives({ version });
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
      [NODE_TYPE]: { value: DOC }
    });
    copy.commentBefore = this.commentBefore;
    copy.comment = this.comment;
    copy.errors = this.errors.slice();
    copy.warnings = this.warnings.slice();
    copy.options = Object.assign({}, this.options);
    if (this.directives)
      copy.directives = this.directives.clone();
    copy.schema = this.schema.clone();
    copy.contents = isNode(this.contents) ? this.contents.clone(copy.schema) : this.contents;
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
  addIn(path, value) {
    if (assertCollection(this.contents))
      this.contents.addIn(path, value);
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
      const prev = anchorNames(this);
      node.anchor = // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
      !name || prev.has(name) ? findNewAnchor(name || "a", prev) : name;
    }
    return new Alias(node.anchor);
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
    const { onAnchor, setAnchors, sourceObjects } = createNodeAnchors(
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
    const node = createNode(value, tag, ctx);
    if (flow && isCollection(node))
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
    return new Pair(k, v);
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
  deleteIn(path) {
    if (isEmptyPath(path)) {
      if (this.contents == null)
        return false;
      this.contents = null;
      return true;
    }
    return assertCollection(this.contents) ? this.contents.deleteIn(path) : false;
  }
  /**
   * Returns item at `key`, or `undefined` if not found. By default unwraps
   * scalar values from their surrounding node; to disable set `keepScalar` to
   * `true` (collections are always returned intact).
   */
  get(key, keepScalar) {
    return isCollection(this.contents) ? this.contents.get(key, keepScalar) : void 0;
  }
  /**
   * Returns item at `path`, or `undefined` if not found. By default unwraps
   * scalar values from their surrounding node; to disable set `keepScalar` to
   * `true` (collections are always returned intact).
   */
  getIn(path, keepScalar) {
    if (isEmptyPath(path))
      return !keepScalar && isScalar(this.contents) ? this.contents.value : this.contents;
    return isCollection(this.contents) ? this.contents.getIn(path, keepScalar) : void 0;
  }
  /**
   * Checks if the document includes a value with the key `key`.
   */
  has(key) {
    return isCollection(this.contents) ? this.contents.has(key) : false;
  }
  /**
   * Checks if the document includes a value at `path`.
   */
  hasIn(path) {
    if (isEmptyPath(path))
      return this.contents !== void 0;
    return isCollection(this.contents) ? this.contents.hasIn(path) : false;
  }
  /**
   * Sets a value in this document. For `!!set`, `value` needs to be a
   * boolean to add/remove the item from the set.
   */
  set(key, value) {
    if (this.contents == null) {
      this.contents = collectionFromPath(this.schema, [key], value);
    } else if (assertCollection(this.contents)) {
      this.contents.set(key, value);
    }
  }
  /**
   * Sets a value in this document. For `!!set`, `value` needs to be a
   * boolean to add/remove the item from the set.
   */
  setIn(path, value) {
    if (isEmptyPath(path)) {
      this.contents = value;
    } else if (this.contents == null) {
      this.contents = collectionFromPath(this.schema, Array.from(path), value);
    } else if (assertCollection(this.contents)) {
      this.contents.setIn(path, value);
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
          this.directives = new Directives({ version: "1.1" });
        opt = { resolveKnownTags: false, schema: "yaml-1.1" };
        break;
      case "1.2":
      case "next":
        if (this.directives)
          this.directives.yaml.version = version;
        else
          this.directives = new Directives({ version });
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
      this.schema = new Schema(Object.assign(opt, options));
    else
      throw new Error(`With a null YAML version, the { schema: Schema } option is required`);
  }
  // json & jsonArg are only used from toJSON()
  toJS({ json: json2, jsonArg, mapAsMap, maxAliasCount, onAnchor, reviver } = {}) {
    const ctx = {
      anchors: /* @__PURE__ */ new Map(),
      doc: this,
      keep: !json2,
      mapAsMap: mapAsMap === true,
      mapKeyWarned: false,
      maxAliasCount: typeof maxAliasCount === "number" ? maxAliasCount : 100
    };
    const res = toJS(this.contents, jsonArg ?? "", ctx);
    if (typeof onAnchor === "function")
      for (const { count: count2, res: res2 } of ctx.anchors.values())
        onAnchor(res2, count2);
    return typeof reviver === "function" ? applyReviver(reviver, { "": res }, "", res) : res;
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
    return stringifyDocument(this, options);
  }
};
function assertCollection(contents) {
  if (isCollection(contents))
    return true;
  throw new Error("Expected a YAML collection as document contents");
}

// node_modules/yaml/browser/dist/errors.js
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

// node_modules/yaml/browser/dist/compose/resolve-props.js
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

// node_modules/yaml/browser/dist/compose/util-contains-newline.js
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

// node_modules/yaml/browser/dist/compose/util-flow-indent-check.js
function flowIndentCheck(indent, fc, onError) {
  if (fc?.type === "flow-collection") {
    const end = fc.end[0];
    if (end.indent === indent && (end.source === "]" || end.source === "}") && containsNewline(fc)) {
      const msg = "Flow end indicator should be more indented than parent";
      onError(end, "BAD_INDENT", msg, true);
    }
  }
}

// node_modules/yaml/browser/dist/compose/util-map-includes.js
function mapIncludes(ctx, items, search) {
  const { uniqueKeys } = ctx.options;
  if (uniqueKeys === false)
    return false;
  const isEqual = typeof uniqueKeys === "function" ? uniqueKeys : (a, b) => a === b || isScalar(a) && isScalar(b) && a.value === b.value;
  return items.some((pair) => isEqual(pair.key, search));
}

// node_modules/yaml/browser/dist/compose/resolve-block-map.js
var startColMsg = "All mapping items must start at the same column";
function resolveBlockMap({ composeNode: composeNode2, composeEmptyNode: composeEmptyNode2 }, ctx, bm, onError, tag) {
  const NodeClass = tag?.nodeClass ?? YAMLMap;
  const map2 = new NodeClass(ctx.schema);
  if (ctx.atRoot)
    ctx.atRoot = false;
  let offset = bm.offset;
  let commentEnd = null;
  for (const collItem of bm.items) {
    const { start, key, sep, value } = collItem;
    const keyProps = resolveProps(start, {
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
          if (map2.comment)
            map2.comment += "\n" + keyProps.comment;
          else
            map2.comment = keyProps.comment;
        }
        continue;
      }
      if (keyProps.newlineAfterProp || containsNewline(key)) {
        onError(key ?? start[start.length - 1], "MULTILINE_IMPLICIT_KEY", "Implicit keys need to be on a single line");
      }
    } else if (keyProps.found?.indent !== bm.indent) {
      onError(offset, "BAD_INDENT", startColMsg);
    }
    ctx.atKey = true;
    const keyStart = keyProps.end;
    const keyNode = key ? composeNode2(ctx, key, keyProps, onError) : composeEmptyNode2(ctx, keyStart, start, null, keyProps, onError);
    if (ctx.schema.compat)
      flowIndentCheck(bm.indent, key, onError);
    ctx.atKey = false;
    if (mapIncludes(ctx, map2.items, keyNode))
      onError(keyStart, "DUPLICATE_KEY", "Map keys must be unique");
    const valueProps = resolveProps(sep ?? [], {
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
      const valueNode = value ? composeNode2(ctx, value, valueProps, onError) : composeEmptyNode2(ctx, offset, sep, null, valueProps, onError);
      if (ctx.schema.compat)
        flowIndentCheck(bm.indent, value, onError);
      offset = valueNode.range[2];
      const pair = new Pair(keyNode, valueNode);
      if (ctx.options.keepSourceTokens)
        pair.srcToken = collItem;
      map2.items.push(pair);
    } else {
      if (implicitKey)
        onError(keyNode.range, "MISSING_CHAR", "Implicit map keys need to be followed by map values");
      if (valueProps.comment) {
        if (keyNode.comment)
          keyNode.comment += "\n" + valueProps.comment;
        else
          keyNode.comment = valueProps.comment;
      }
      const pair = new Pair(keyNode);
      if (ctx.options.keepSourceTokens)
        pair.srcToken = collItem;
      map2.items.push(pair);
    }
  }
  if (commentEnd && commentEnd < offset)
    onError(commentEnd, "IMPOSSIBLE", "Map comment with trailing content");
  map2.range = [bm.offset, offset, commentEnd ?? offset];
  return map2;
}

// node_modules/yaml/browser/dist/compose/resolve-block-seq.js
function resolveBlockSeq({ composeNode: composeNode2, composeEmptyNode: composeEmptyNode2 }, ctx, bs, onError, tag) {
  const NodeClass = tag?.nodeClass ?? YAMLSeq;
  const seq2 = new NodeClass(ctx.schema);
  if (ctx.atRoot)
    ctx.atRoot = false;
  if (ctx.atKey)
    ctx.atKey = false;
  let offset = bs.offset;
  let commentEnd = null;
  for (const { start, value } of bs.items) {
    const props = resolveProps(start, {
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
          seq2.comment = props.comment;
        continue;
      }
    }
    const node = value ? composeNode2(ctx, value, props, onError) : composeEmptyNode2(ctx, props.end, start, null, props, onError);
    if (ctx.schema.compat)
      flowIndentCheck(bs.indent, value, onError);
    offset = node.range[2];
    seq2.items.push(node);
  }
  seq2.range = [bs.offset, offset, commentEnd ?? offset];
  return seq2;
}

// node_modules/yaml/browser/dist/compose/resolve-end.js
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

// node_modules/yaml/browser/dist/compose/resolve-flow-collection.js
var blockMsg = "Block collections are not allowed within flow collections";
var isBlock = (token) => token && (token.type === "block-map" || token.type === "block-seq");
function resolveFlowCollection({ composeNode: composeNode2, composeEmptyNode: composeEmptyNode2 }, ctx, fc, onError, tag) {
  const isMap2 = fc.start.source === "{";
  const fcName = isMap2 ? "flow map" : "flow sequence";
  const NodeClass = tag?.nodeClass ?? (isMap2 ? YAMLMap : YAMLSeq);
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
    const props = resolveProps(start, {
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
      if (!isMap2 && ctx.options.strict && containsNewline(key))
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
          if (isPair(prev))
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
      const valueNode = value ? composeNode2(ctx, value, props, onError) : composeEmptyNode2(ctx, props.end, sep, null, props, onError);
      coll.items.push(valueNode);
      offset = valueNode.range[2];
      if (isBlock(value))
        onError(valueNode.range, "BLOCK_IN_FLOW", blockMsg);
    } else {
      ctx.atKey = true;
      const keyStart = props.end;
      const keyNode = key ? composeNode2(ctx, key, props, onError) : composeEmptyNode2(ctx, keyStart, start, null, props, onError);
      if (isBlock(key))
        onError(keyNode.range, "BLOCK_IN_FLOW", blockMsg);
      ctx.atKey = false;
      const valueProps = resolveProps(sep ?? [], {
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
      const valueNode = value ? composeNode2(ctx, value, valueProps, onError) : valueProps.found ? composeEmptyNode2(ctx, valueProps.end, sep, null, valueProps, onError) : null;
      if (valueNode) {
        if (isBlock(value))
          onError(valueNode.range, "BLOCK_IN_FLOW", blockMsg);
      } else if (valueProps.comment) {
        if (keyNode.comment)
          keyNode.comment += "\n" + valueProps.comment;
        else
          keyNode.comment = valueProps.comment;
      }
      const pair = new Pair(keyNode, valueNode);
      if (ctx.options.keepSourceTokens)
        pair.srcToken = collItem;
      if (isMap2) {
        const map2 = coll;
        if (mapIncludes(ctx, map2.items, keyNode))
          onError(keyStart, "DUPLICATE_KEY", "Map keys must be unique");
        map2.items.push(pair);
      } else {
        const map2 = new YAMLMap(ctx.schema);
        map2.flow = true;
        map2.items.push(pair);
        const endRange = (valueNode ?? keyNode).range;
        map2.range = [keyNode.range[0], endRange[1], endRange[2]];
        coll.items.push(map2);
      }
      offset = valueNode ? valueNode.range[2] : valueProps.end;
    }
  }
  const expectedEnd = isMap2 ? "}" : "]";
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
    const end = resolveEnd(ee, cePos, ctx.options.strict, onError);
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

// node_modules/yaml/browser/dist/compose/compose-collection.js
function resolveCollection(CN2, ctx, token, onError, tagName, tag) {
  const coll = token.type === "block-map" ? resolveBlockMap(CN2, ctx, token, onError, tag) : token.type === "block-seq" ? resolveBlockSeq(CN2, ctx, token, onError, tag) : resolveFlowCollection(CN2, ctx, token, onError, tag);
  const Coll = coll.constructor;
  if (tagName === "!" || tagName === Coll.tagName) {
    coll.tag = Coll.tagName;
    return coll;
  }
  if (tagName)
    coll.tag = tagName;
  return coll;
}
function composeCollection(CN2, ctx, token, props, onError) {
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
  if (!tagToken || !tagName || tagName === "!" || tagName === YAMLMap.tagName && expType === "map" || tagName === YAMLSeq.tagName && expType === "seq") {
    return resolveCollection(CN2, ctx, token, onError, tagName);
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
      return resolveCollection(CN2, ctx, token, onError, tagName);
    }
  }
  const coll = resolveCollection(CN2, ctx, token, onError, tagName, tag);
  const res = tag.resolve?.(coll, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg), ctx.options) ?? coll;
  const node = isNode(res) ? res : new Scalar(res);
  node.range = coll.range;
  node.tag = tagName;
  if (tag?.format)
    node.format = tag.format;
  return node;
}

// node_modules/yaml/browser/dist/compose/resolve-block-scalar.js
function resolveBlockScalar(ctx, scalar, onError) {
  const start = scalar.offset;
  const header = parseBlockScalarHeader(scalar, ctx.options.strict, onError);
  if (!header)
    return { value: "", type: null, comment: "", range: [start, start, start] };
  const type = header.mode === ">" ? Scalar.BLOCK_FOLDED : Scalar.BLOCK_LITERAL;
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
    if (type === Scalar.BLOCK_LITERAL) {
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
      const n2 = Number(ch);
      if (!indent && n2)
        indent = n2;
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

// node_modules/yaml/browser/dist/compose/resolve-flow-scalar.js
function resolveFlowScalar(scalar, strict, onError) {
  const { offset, type, source, end } = scalar;
  let _type;
  let value;
  const _onError = (rel, code, msg) => onError(offset + rel, code, msg);
  switch (type) {
    case "scalar":
      _type = Scalar.PLAIN;
      value = plainValue(source, _onError);
      break;
    case "single-quoted-scalar":
      _type = Scalar.QUOTE_SINGLE;
      value = singleQuotedValue(source, _onError);
      break;
    case "double-quoted-scalar":
      _type = Scalar.QUOTE_DOUBLE;
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
  const re = resolveEnd(end, valueEnd, strict, onError);
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

// node_modules/yaml/browser/dist/compose/compose-scalar.js
function composeScalar(ctx, token, tagToken, onError) {
  const { value, type, comment, range } = token.type === "block-scalar" ? resolveBlockScalar(ctx, token, onError) : resolveFlowScalar(token, ctx.options.strict, onError);
  const tagName = tagToken ? ctx.directives.tagName(tagToken.source, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg)) : null;
  let tag;
  if (ctx.options.stringKeys && ctx.atKey) {
    tag = ctx.schema[SCALAR];
  } else if (tagName)
    tag = findScalarTagByName(ctx.schema, value, tagName, tagToken, onError);
  else if (token.type === "scalar")
    tag = findScalarTagByTest(ctx, value, token, onError);
  else
    tag = ctx.schema[SCALAR];
  let scalar;
  try {
    const res = tag.resolve(value, (msg) => onError(tagToken ?? token, "TAG_RESOLVE_FAILED", msg), ctx.options);
    scalar = isScalar(res) ? res : new Scalar(res);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    onError(tagToken ?? token, "TAG_RESOLVE_FAILED", msg);
    scalar = new Scalar(value);
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
function findScalarTagByName(schema4, value, tagName, tagToken, onError) {
  if (tagName === "!")
    return schema4[SCALAR];
  const matchWithTest = [];
  for (const tag of schema4.tags) {
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
  const kt = schema4.knownTags[tagName];
  if (kt && !kt.collection) {
    schema4.tags.push(Object.assign({}, kt, { default: false, test: void 0 }));
    return kt;
  }
  onError(tagToken, "TAG_RESOLVE_FAILED", `Unresolved tag: ${tagName}`, tagName !== "tag:yaml.org,2002:str");
  return schema4[SCALAR];
}
function findScalarTagByTest({ atKey, directives, schema: schema4 }, value, token, onError) {
  const tag = schema4.tags.find((tag2) => (tag2.default === true || atKey && tag2.default === "key") && tag2.test?.test(value)) || schema4[SCALAR];
  if (schema4.compat) {
    const compat = schema4.compat.find((tag2) => tag2.default && tag2.test?.test(value)) ?? schema4[SCALAR];
    if (tag.tag !== compat.tag) {
      const ts = directives.tagString(tag.tag);
      const cs = directives.tagString(compat.tag);
      const msg = `Value may be parsed as either ${ts} or ${cs}`;
      onError(token, "TAG_RESOLVE_FAILED", msg, true);
    }
  }
  return tag;
}

// node_modules/yaml/browser/dist/compose/util-empty-scalar-position.js
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

// node_modules/yaml/browser/dist/compose/compose-node.js
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
      node = composeScalar(ctx, token, tag, onError);
      if (anchor)
        node.anchor = anchor.source.substring(1);
      break;
    case "block-map":
    case "block-seq":
    case "flow-collection":
      try {
        node = composeCollection(CN, ctx, token, props, onError);
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
  if (atKey && ctx.options.stringKeys && (!isScalar(node) || typeof node.value !== "string" || node.tag && node.tag !== "tag:yaml.org,2002:str")) {
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
    offset: emptyScalarPosition(offset, before, pos),
    indent: -1,
    source: ""
  };
  const node = composeScalar(ctx, token, tag, onError);
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
  const alias = new Alias(source.substring(1));
  if (alias.source === "")
    onError(offset, "BAD_ALIAS", "Alias cannot be an empty string");
  if (alias.source.endsWith(":"))
    onError(offset + source.length - 1, "BAD_ALIAS", "Alias ending in : is ambiguous", true);
  const valueEnd = offset + source.length;
  const re = resolveEnd(end, valueEnd, options.strict, onError);
  alias.range = [offset, valueEnd, re.offset];
  if (re.comment)
    alias.comment = re.comment;
  return alias;
}

// node_modules/yaml/browser/dist/compose/compose-doc.js
function composeDoc(options, directives, { offset, start, value, end }, onError) {
  const opts = Object.assign({ _directives: directives }, options);
  const doc = new Document(void 0, opts);
  const ctx = {
    atKey: false,
    atRoot: true,
    directives: doc.directives,
    options: doc.options,
    schema: doc.schema
  };
  const props = resolveProps(start, {
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
  doc.contents = value ? composeNode(ctx, value, props, onError) : composeEmptyNode(ctx, props.end, start, null, props, onError);
  const contentEnd = doc.contents.range[2];
  const re = resolveEnd(end, contentEnd, false, onError);
  if (re.comment)
    doc.comment = re.comment;
  doc.range = [offset, contentEnd, re.offset];
  return doc;
}

// node_modules/yaml/browser/dist/compose/composer.js
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
        this.warnings.push(new YAMLWarning(pos, code, message));
      else
        this.errors.push(new YAMLParseError(pos, code, message));
    };
    this.directives = new Directives({ version: options.version || "1.2" });
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
      } else if (isCollection(dc) && !dc.flow && dc.items.length > 0) {
        let it = dc.items[0];
        if (isPair(it))
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
        const doc = composeDoc(this.options, this.directives, token, this.onError);
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
        const error = new YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", msg);
        if (this.atDirectives || !this.doc)
          this.errors.push(error);
        else
          this.doc.errors.push(error);
        break;
      }
      case "doc-end": {
        if (!this.doc) {
          const msg = "Unexpected doc-end without preceding document";
          this.errors.push(new YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", msg));
          break;
        }
        this.doc.directives.docEnd = true;
        const end = resolveEnd(token.end, token.offset + token.source.length, this.doc.options.strict, this.onError);
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
        this.errors.push(new YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", `Unsupported token ${token.type}`));
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
      const doc = new Document(void 0, opts);
      if (this.atDirectives)
        this.onError(endOffset, "MISSING_CHAR", "Missing directives-end indicator line");
      doc.range = [0, endOffset, endOffset];
      this.decorate(doc, false);
      yield doc;
    }
  }
};

// node_modules/yaml/browser/dist/parse/cst-visit.js
var BREAK2 = Symbol("break visit");
var SKIP2 = Symbol("skip children");
var REMOVE2 = Symbol("remove item");
function visit2(cst, visitor) {
  if ("type" in cst && cst.type === "document")
    cst = { start: cst.start, value: cst.value };
  _visit(Object.freeze([]), cst, visitor);
}
visit2.BREAK = BREAK2;
visit2.SKIP = SKIP2;
visit2.REMOVE = REMOVE2;
visit2.itemAtPath = (cst, path) => {
  let item = cst;
  for (const [field, index] of path) {
    const tok2 = item?.[field];
    if (tok2 && "items" in tok2) {
      item = tok2.items[index];
    } else
      return void 0;
  }
  return item;
};
visit2.parentCollection = (cst, path) => {
  const parent = visit2.itemAtPath(cst, path.slice(0, -1));
  const field = path[path.length - 1][0];
  const coll = parent?.[field];
  if (coll && "items" in coll)
    return coll;
  throw new Error("Parent collection not found");
};
function _visit(path, item, visitor) {
  let ctrl = visitor(item, path);
  if (typeof ctrl === "symbol")
    return ctrl;
  for (const field of ["key", "value"]) {
    const token = item[field];
    if (token && "items" in token) {
      for (let i = 0; i < token.items.length; ++i) {
        const ci = _visit(Object.freeze(path.concat([[field, i]])), token.items[i], visitor);
        if (typeof ci === "number")
          i = ci - 1;
        else if (ci === BREAK2)
          return BREAK2;
        else if (ci === REMOVE2) {
          token.items.splice(i, 1);
          i -= 1;
        }
      }
      if (typeof ctrl === "function" && field === "key")
        ctrl = ctrl(item, path);
    }
  }
  return typeof ctrl === "function" ? ctrl(item, path) : ctrl;
}

// node_modules/yaml/browser/dist/parse/cst.js
var BOM = "\uFEFF";
var DOCUMENT = "";
var FLOW_END = "";
var SCALAR2 = "";
function tokenType(source) {
  switch (source) {
    case BOM:
      return "byte-order-mark";
    case DOCUMENT:
      return "doc-mode";
    case FLOW_END:
      return "flow-error-end";
    case SCALAR2:
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

// node_modules/yaml/browser/dist/parse/lexer.js
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
  charAt(n2) {
    return this.buffer[this.pos + n2];
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
  hasChars(n2) {
    return this.pos + n2 <= this.buffer.length;
  }
  setNext(state) {
    this.buffer = this.buffer.substring(this.pos);
    this.pos = 0;
    this.lineEndPos = null;
    this.next = state;
    return null;
  }
  peek(n2) {
    return this.buffer.substr(this.pos, n2);
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
    if (line[0] === BOM) {
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
      const n2 = (yield* this.pushCount(dirEnd)) + (yield* this.pushSpaces(true));
      yield* this.pushCount(line.length - n2);
      this.pushNewline();
      return "stream";
    }
    if (this.atLineEnd()) {
      const sp = yield* this.pushSpaces(true);
      yield* this.pushCount(line.length - sp);
      yield* this.pushNewline();
      return "stream";
    }
    yield DOCUMENT;
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
      const n2 = (yield* this.pushCount(1)) + (yield* this.pushSpaces(true));
      this.indentNext = this.indentValue + 1;
      this.indentValue += n2;
      return "block-start";
    }
    return "doc";
  }
  *parseDocument() {
    yield* this.pushSpaces(true);
    const line = this.getLine();
    if (line === null)
      return this.setNext("doc");
    let n2 = yield* this.pushIndicators();
    switch (line[n2]) {
      case "#":
        yield* this.pushCount(line.length - n2);
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
        n2 += yield* this.parseBlockScalarHeader();
        n2 += yield* this.pushSpaces(true);
        yield* this.pushCount(line.length - n2);
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
        yield FLOW_END;
        return yield* this.parseLineStart();
      }
    }
    let n2 = 0;
    while (line[n2] === ",") {
      n2 += yield* this.pushCount(1);
      n2 += yield* this.pushSpaces(true);
      this.flowKey = false;
    }
    n2 += yield* this.pushIndicators();
    switch (line[n2]) {
      case void 0:
        return "flow";
      case "#":
        yield* this.pushCount(line.length - n2);
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
        let n2 = 0;
        while (this.buffer[end - 1 - n2] === "\\")
          n2 += 1;
        if (n2 % 2 === 0)
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
    yield SCALAR2;
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
    yield SCALAR2;
    yield* this.pushToIndex(end + 1, true);
    return inFlow ? "flow" : "doc";
  }
  *pushCount(n2) {
    if (n2 > 0) {
      yield this.buffer.substr(this.pos, n2);
      this.pos += n2;
      return n2;
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
    let n2 = 0;
    loop: while (true) {
      switch (this.charAt(0)) {
        case "!":
          n2 += yield* this.pushTag();
          n2 += yield* this.pushSpaces(true);
          continue loop;
        case "&":
          n2 += yield* this.pushUntil(isNotAnchorChar);
          n2 += yield* this.pushSpaces(true);
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
            n2 += yield* this.pushCount(1);
            n2 += yield* this.pushSpaces(true);
            continue loop;
          }
        }
      }
      break loop;
    }
    return n2;
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
    const n2 = i - this.pos;
    if (n2 > 0) {
      yield this.buffer.substr(this.pos, n2);
      this.pos = i;
    }
    return n2;
  }
  *pushUntil(test) {
    let i = this.pos;
    let ch = this.buffer[i];
    while (!test(ch))
      ch = this.buffer[++i];
    return yield* this.pushToIndex(i, false);
  }
};

// node_modules/yaml/browser/dist/parse/line-counter.js
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

// node_modules/yaml/browser/dist/parse/parser.js
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
    this.lexer = new Lexer();
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
    if (this.atScalar) {
      this.atScalar = false;
      yield* this.step();
      this.offset += source.length;
      return;
    }
    const type = tokenType(source);
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
  peek(n2) {
    return this.stack[this.stack.length - n2];
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
      const map2 = {
        type: "block-map",
        offset: scalar.offset,
        indent: scalar.indent,
        items: [{ start, key: scalar, sep }]
      };
      this.onKeyLine = true;
      this.stack[this.stack.length - 1] = map2;
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
  *blockMap(map2) {
    const it = map2.items[map2.items.length - 1];
    switch (this.type) {
      case "newline":
        this.onKeyLine = false;
        if (it.value) {
          const end = "end" in it.value ? it.value.end : void 0;
          const last = Array.isArray(end) ? end[end.length - 1] : void 0;
          if (last?.type === "comment")
            end?.push(this.sourceToken);
          else
            map2.items.push({ start: [this.sourceToken] });
        } else if (it.sep) {
          it.sep.push(this.sourceToken);
        } else {
          it.start.push(this.sourceToken);
        }
        return;
      case "space":
      case "comment":
        if (it.value) {
          map2.items.push({ start: [this.sourceToken] });
        } else if (it.sep) {
          it.sep.push(this.sourceToken);
        } else {
          if (this.atIndentedComment(it.start, map2.indent)) {
            const prev = map2.items[map2.items.length - 2];
            const end = prev?.value?.end;
            if (Array.isArray(end)) {
              arrayPushArray(end, it.start);
              end.push(this.sourceToken);
              map2.items.pop();
              return;
            }
          }
          it.start.push(this.sourceToken);
        }
        return;
    }
    if (this.indent >= map2.indent) {
      const atMapIndent = !this.onKeyLine && this.indent === map2.indent;
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
              if (st.indent > map2.indent)
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
            map2.items.push({ start });
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
            map2.items.push({ start, explicitKey: true });
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
              map2.items.push({ start: [], key: null, sep: [this.sourceToken] });
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
              map2.items.push({ start, key: null, sep: [this.sourceToken] });
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
            map2.items.push({ start, key: fs, sep: [] });
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
          const bv = this.startBlockValue(map2);
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
              map2.items.push({ start });
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
  *blockSequence(seq2) {
    const it = seq2.items[seq2.items.length - 1];
    switch (this.type) {
      case "newline":
        if (it.value) {
          const end = "end" in it.value ? it.value.end : void 0;
          const last = Array.isArray(end) ? end[end.length - 1] : void 0;
          if (last?.type === "comment")
            end?.push(this.sourceToken);
          else
            seq2.items.push({ start: [this.sourceToken] });
        } else
          it.start.push(this.sourceToken);
        return;
      case "space":
      case "comment":
        if (it.value)
          seq2.items.push({ start: [this.sourceToken] });
        else {
          if (this.atIndentedComment(it.start, seq2.indent)) {
            const prev = seq2.items[seq2.items.length - 2];
            const end = prev?.value?.end;
            if (Array.isArray(end)) {
              arrayPushArray(end, it.start);
              end.push(this.sourceToken);
              seq2.items.pop();
              return;
            }
          }
          it.start.push(this.sourceToken);
        }
        return;
      case "anchor":
      case "tag":
        if (it.value || this.indent <= seq2.indent)
          break;
        it.start.push(this.sourceToken);
        return;
      case "seq-item-ind":
        if (this.indent !== seq2.indent)
          break;
        if (it.value || includesToken(it.start, "seq-item-ind"))
          seq2.items.push({ start: [this.sourceToken] });
        else
          it.start.push(this.sourceToken);
        return;
    }
    if (this.indent > seq2.indent) {
      const bv = this.startBlockValue(seq2);
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
        const map2 = {
          type: "block-map",
          offset: fc.offset,
          indent: fc.indent,
          items: [{ start, key: fc, sep }]
        };
        this.onKeyLine = true;
        this.stack[this.stack.length - 1] = map2;
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

// node_modules/yaml/browser/dist/public-api.js
function parseOptions(options) {
  const prettyErrors = options.prettyErrors !== false;
  const lineCounter = options.lineCounter || prettyErrors && new LineCounter() || null;
  return { lineCounter, prettyErrors };
}
function parseDocument(source, options = {}) {
  const { lineCounter, prettyErrors } = parseOptions(options);
  const parser = new Parser(lineCounter?.addNewLine);
  const composer = new Composer(options);
  let doc = null;
  for (const _doc of composer.compose(parser.parse(source), true, source.length)) {
    if (!doc)
      doc = _doc;
    else if (doc.options.logLevel !== "silent") {
      doc.errors.push(new YAMLParseError(_doc.range.slice(0, 2), "MULTIPLE_DOCS", "Source contains multiple documents; please use YAML.parseAllDocuments()"));
      break;
    }
  }
  if (prettyErrors && lineCounter) {
    doc.errors.forEach(prettifyError(source, lineCounter));
    doc.warnings.forEach(prettifyError(source, lineCounter));
  }
  return doc;
}
function parse(src, reviver, options) {
  let _reviver = void 0;
  if (typeof reviver === "function") {
    _reviver = reviver;
  } else if (options === void 0 && reviver && typeof reviver === "object") {
    options = reviver;
  }
  const doc = parseDocument(src, options);
  if (!doc)
    return null;
  doc.warnings.forEach((warning) => warn(doc.options.logLevel, warning));
  if (doc.errors.length > 0) {
    if (doc.options.logLevel !== "silent")
      throw doc.errors[0];
    else
      doc.errors = [];
  }
  return doc.toJS(Object.assign({ reviver: _reviver }, options));
}

// src/lib/design.ts
var ID = /^[A-Za-z0-9_.-]{1,64}$/;
var MetaSchema = external_exports.object({
  title: external_exports.string().min(1),
  project: external_exports.string().regex(ID, "invalid id (allowed: letters, digits, _ . -; max 64)").refine((s) => s !== "." && s !== "..", "invalid id"),
  locale: external_exports.string().min(1).default("en"),
  summary: external_exports.string().min(1),
  pillars: external_exports.array(external_exports.object({ title: external_exports.string().min(1), text: external_exports.string().min(1) })).max(8).default([]),
  start_prompt: external_exports.string().min(1).default("/waypoint:work <track>"),
  status: external_exports.enum(["draft", "approved", "parked"]).default("draft"),
  artifact: external_exports.string().url().optional(),
  source: external_exports.string().min(1).max(300).optional()
});
var DesignError = class extends Error {
  constructor(issues) {
    super(`Invalid design:
- ${issues.join("\n- ")}`);
    this.issues = issues;
    this.name = "DesignError";
  }
};
var FM = /^---\r?\n(?:([\s\S]*?)\r?\n)?---\r?\n?([\s\S]*)$/;
var BOM2 = String.fromCharCode(65279);
function parseDesign(text2) {
  const m = FM.exec(text2.startsWith(BOM2) ? text2.slice(1) : text2);
  if (!m) throw new DesignError(["missing front matter block (--- ... ---) at the top of design.md"]);
  let raw;
  try {
    raw = parse(m[1] ?? "");
  } catch (e) {
    throw new DesignError([`YAML: ${e.message}`]);
  }
  const r = MetaSchema.safeParse(raw ?? {});
  if (!r.success) throw new DesignError(r.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`));
  const body = m[2];
  return { meta: r.data, body, sections: sectionsOf(body), words: wordCount(body) };
}
var SLUG_MAX = 80;
var cutSlug = (slug, max) => slug.slice(0, max).replace(/-+$/, "");
function slugify(heading) {
  const slug = heading.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return cutSlug(slug, SLUG_MAX) || "section";
}
var nthSlug = (base, n2) => `${cutSlug(base, SLUG_MAX - `-${n2}`.length)}-${n2}`;
function sectionsOf(body) {
  return parseSections(body).sections;
}
function parseSections(body) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  let fence = null;
  let cur = null;
  const lines = [];
  const introLines = [];
  const flush = () => {
    if (cur) {
      cur.text = lines.join("\n").trim();
      out.push(cur);
    }
    lines.length = 0;
  };
  for (const line of body.split(/\r?\n/)) {
    const isHeading = !fence && /^(#{2,3})\s+(.+?)(?:\s+#+)?\s*$/.exec(line);
    if (fence) {
      const close = /^\s*(`{3,}|~{3,})\s*$/.exec(line);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null;
    } else {
      const open = /^\s*(`{3,}|~{3,})/.exec(line);
      if (open) fence = open[1];
    }
    if (isHeading) {
      flush();
      const base = slugify(isHeading[2]);
      let slug = base;
      for (let n2 = 2; seen.has(slug); n2++) slug = nthSlug(base, n2);
      seen.add(slug);
      cur = { level: isHeading[1].length, heading: isHeading[2], slug, text: "" };
    } else if (cur) {
      lines.push(line);
    } else {
      introLines.push(line);
    }
  }
  flush();
  return { intro: introLines.join("\n").trim(), sections: out };
}
function wordCount(body) {
  return body.replace(/[#>*_`~\-|[\]()]/g, " ").split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

// src/lib/decisions.ts
var DECISION_POINTS = ["route", "triage", "design-apply", "design-approve", "plan-confirm", "mode", "ruling", "safe-path", "takeover", "revert", "other"];
var DECISIONS_MAX = 16 * 1024;
var DECISIONS_WINDOW_MS = 24 * 36e5;
var LAST_MAX = 5;
var FUTURE_SKEW_MS = 5 * 6e4;
var SHORT = 80;
var isObj = (x) => !!x && typeof x === "object" && !Array.isArray(x);
var str = (x) => typeof x === "string";
var oneOf = (list, x) => str(x) && list.includes(x) ? x : null;
var cp = (n2) => String.fromCharCode(n2);
var UNSAFE = new RegExp(`[\\x00-\\x1f\\x7f-\\x9f${cp(8234)}-${cp(8238)}${cp(8294)}-${cp(8297)}]`, "g");
var clean = (s, max) => {
  const t = s.replace(UNSAFE, " ").replace(/\s+/g, " ").trim();
  return t.length <= max ? t : Array.from(t).slice(0, max).join("");
};
var text = (x, max) => str(x) ? clean(x, max) || null : null;
var posInt = (x) => typeof x === "number" && Number.isInteger(x) && x > 0 ? x : null;
function entryOf(x) {
  if (!isObj(x)) return null;
  const n2 = posInt(x.n);
  const ts = str(x.ts) && x.ts ? x.ts : null;
  const point = oneOf(DECISION_POINTS, x.point);
  const what = text(x.what, SHORT);
  const chosen = text(x.chosen, SHORT);
  return n2 && ts && point && what && chosen ? { n: n2, point, what, chosen, ts } : null;
}
function normalizeDecisionsDoc(x) {
  if (!isObj(x)) return null;
  const ts = str(x.ts) && x.ts ? x.ts : null;
  const scope = text(x.scope, 120);
  const count2 = typeof x.count === "number" && Number.isInteger(x.count) && x.count >= 0 ? x.count : null;
  const autonomy = x.autonomy === "auto" || x.autonomy === "unattended" ? x.autonomy : null;
  if (!ts || !scope || count2 === null || !autonomy) return null;
  const last = [];
  for (const e of Array.isArray(x.last) ? x.last : []) {
    const entry = entryOf(e);
    if (entry && isObj(e)) last.push({ ...entry, weight: e.weight === "major" ? "major" : "minor" });
  }
  return { ts, scope, count: count2, autonomy, last: last.slice(-LAST_MAX), lastMajor: entryOf(x.lastMajor) };
}
function decisionsSummary(text2, now) {
  if (typeof text2 !== "string" || text2.length > DECISIONS_MAX) return null;
  let doc;
  try {
    doc = normalizeDecisionsDoc(JSON.parse(text2));
  } catch {
    return null;
  }
  if (!doc || doc.count < 1) return null;
  const t = Date.parse(doc.ts);
  if (!Number.isFinite(t) || !Number.isFinite(now) || now - t > DECISIONS_WINDOW_MS || t - now > FUTURE_SKEW_MS) return null;
  return { count: doc.count, autonomy: doc.autonomy, lastMajor: doc.lastMajor?.what ?? null };
}

// src/lib/design-gate.ts
var REASON_MAX = 300;
var APPLIED_NOTE = /\b(?:round|ronda)\s+(\d+)\s*:\s*(?:applied|aplicad[ao]s?)\s+(\d+(?:\s*(?:,|y|and)\s*\d+)*)/gi;
var REWRITE_NOTE = /^\s*(?:round|ronda)\s+(\d+)\s*:\s*(?:rewrite|reescritura|reescrit[ao])/i;
var legacy = (e) => e.applied === void 0 && e.rewrite === void 0;
function appliedIn(changelog, round) {
  const out = /* @__PURE__ */ new Set();
  for (const e of changelog) {
    if (e.applied) {
      for (const n2 of e.applied[round] ?? []) out.add(n2);
      continue;
    }
    if (!legacy(e)) continue;
    for (const m of e.note.matchAll(APPLIED_NOTE)) {
      if (Number(m[1]) !== round) continue;
      for (const n2 of m[2].split(/\s*(?:,|y|and)\s*/i)) if (/^\d+$/.test(n2)) out.add(Number(n2));
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
function resolvedIn(changelog, round) {
  return new Set(changelog.flatMap((e) => (e.resolved ?? []).filter((x) => x.round === round).map((x) => x.n)));
}
function parseDismissed(text2) {
  let raw;
  try {
    raw = JSON.parse(text2 ?? "");
  } catch {
    return {};
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!/^[1-9]\d*$/.test(k) || !Array.isArray(v)) continue;
    const byN = /* @__PURE__ */ new Map();
    for (const x of v) {
      const item = x && typeof x === "object" ? x : null;
      const n2 = item ? item.n : x;
      if (typeof n2 !== "number" || !Number.isInteger(n2) || n2 <= 0) continue;
      const reason = item && typeof item.reason === "string" ? clean(item.reason, REASON_MAX) : "";
      byN.set(n2, reason ? { n: n2, reason } : byN.get(n2) ?? { n: n2 });
    }
    if (byN.size) out[Number(k)] = [...byN.values()].sort((a, b) => a.n - b.n);
  }
  return out;
}
function pendingProposals(changelog, critiques, dismissed = {}) {
  const out = [];
  for (const { round, critique } of [...critiques].sort((a, b) => a.round - b.round)) {
    if (!critique || rewroteRound(changelog, round)) continue;
    const decided = /* @__PURE__ */ new Set([...appliedIn(changelog, round), ...resolvedIn(changelog, round), ...(dismissed[round] ?? []).map((x) => x.n)]);
    for (const p of critique.proposals) {
      if (!decided.has(p.n)) out.push({ round, n: p.n, severity: p.severity, section: p.section, problem: p.problem });
    }
  }
  return out;
}

// src/lib/types.ts
var TRACK_COLORS = ["blue", "mauve", "teal", "pink", "sky", "flamingo"];
var STAGES = ["brief", "implement", "validate", "verify", "review", "verdict", "integrate"];

// src/lib/ids.ts
var realDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && (/* @__PURE__ */ new Date(`${v}T00:00:00Z`)).toISOString().slice(0, 10) === v;
var PLAN_ID_RE = /^[A-Za-z0-9_.-]{1,64}$/;
var isPlanId = (s) => PLAN_ID_RE.test(s) && s !== "." && s !== "..";

// src/lib/plan.ts
var id = external_exports.string().regex(PLAN_ID_RE, "invalid id (allowed: letters, digits, _ - .; max 64)").refine((s) => s !== "." && s !== "..", "invalid id");
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
  estimate_min: external_exports.number().positive().optional(),
  delicate: external_exports.boolean().optional(),
  // G-25, K3-08: the section of the design the task comes from (a heading's slug, or _intro).
  design_ref: external_exports.string().regex(/^[a-z0-9-]{1,80}$|^_intro$/, "design_ref must be a section slug of the design").optional()
});
var PlanSchema = external_exports.object({
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
var PlanError = class extends Error {
  constructor(issues) {
    super(`Invalid plan:
- ${issues.join("\n- ")}`);
    this.issues = issues;
    this.name = "PlanError";
  }
};
function parsePlan(text2) {
  let raw;
  try {
    raw = parse(text2);
  } catch (e) {
    throw new PlanError([`YAML: ${e.message}`]);
  }
  const r = PlanSchema.safeParse(raw);
  if (!r.success) throw new PlanError(r.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`));
  const plan = r.data;
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
  const visit3 = (n2) => {
    if (mark.get(n2) === 2) return null;
    if (mark.get(n2) === 1) return [...stack.slice(stack.indexOf(n2)), n2];
    mark.set(n2, 1);
    stack.push(n2);
    for (const d of deps.get(n2) ?? []) {
      const c2 = visit3(d);
      if (c2) return c2;
    }
    stack.pop();
    mark.set(n2, 2);
    return null;
  };
  for (const t of plan.tasks) {
    const c2 = visit3(t.id);
    if (c2) return c2;
  }
  return null;
}

// src/lib/forge-run.ts
var LOCALE = /^[a-z]{2,3}([-_][A-Za-z0-9]{2,8})?$/;
var isLocale = (x) => typeof x === "string" && LOCALE.test(x);
var isCount = (x) => typeof x === "number" && Number.isInteger(x) && x >= 0;
var isPositiveInt = (x) => isCount(x) && x > 0;
var isPositive = (x) => typeof x === "number" && Number.isFinite(x) && x > 0;
function parseRun(text2) {
  if (text2 === null) return null;
  let o;
  try {
    const x = JSON.parse(text2);
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
  const run = {
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
  if (o.stoppedReason !== void 0) run.stoppedReason = o.stoppedReason;
  if (isLocale(o.locale)) run.locale = o.locale;
  return run;
}

// src/lib/execution-state.ts
var SAFE_ID = /^[A-Za-z0-9_\-.]{1,120}$/;
var isSafeId = (s) => typeof s === "string" && SAFE_ID.test(s) && s !== "." && s !== "..";
var RUN_BRANCH = /^[A-Za-z0-9_./][A-Za-z0-9_\-./]{0,119}$/;
var isRunBranch = (s) => typeof s === "string" && RUN_BRANCH.test(s) && !s.includes("..");
var TASK_STATUSES = ["running", "accepted", "integrated", "conflict", "blocked", "stopped"];
var STOPS = ["finished", "stalled", "stopped", "budget", "migrated"];
var MAX_TASKS = 500;
var isObj2 = (x) => !!x && typeof x === "object" && !Array.isArray(x);
var str2 = (x) => typeof x === "string" && x ? x : null;
var iso = (x) => typeof x === "string" && !Number.isNaN(Date.parse(x)) ? x : null;
var FUTURE_SKEW_MS2 = 12e4;
var finishedOf = (x, now) => {
  const v = iso(x);
  if (!v) return null;
  return now !== void 0 && Number.isFinite(now) && Date.parse(v) - now > FUTURE_SKEW_MS2 ? null : v;
};
var int3 = (x, min, max, dflt) => typeof x === "number" && Number.isInteger(x) ? Math.min(max, Math.max(min, x)) : dflt;
var oneOf2 = (list, x) => list.includes(x) ? x : null;
var cleanTitle = (x) => typeof x === "string" ? x.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim().slice(0, 200) : "";
function normalizeTask(x, now) {
  if (!isObj2(x)) return null;
  const status = oneOf2(TASK_STATUSES, x.status);
  const stage = oneOf2(STAGES, x.stage);
  const executor = oneOf2(["subagents", "sessions", "manual"], x.executor);
  const worktree = typeof x.worktree === "string" ? x.worktree : null;
  const branch = str2(x.branch);
  const startedAt = iso(x.startedAt);
  if (!status || !stage || !executor || worktree === null || !branch || !startedAt) return null;
  const title = cleanTitle(x.title);
  return {
    status,
    stage,
    executor,
    worktree,
    branch,
    startedAt,
    stageSince: iso(x.stageSince) ?? startedAt,
    round: int3(x.round, 0, 99, 0),
    attempts: int3(x.attempts, 0, 99, 0),
    agent: str2(x.agent),
    updatedAt: iso(x.updatedAt) ?? startedAt,
    detail: typeof x.detail === "string" ? x.detail.slice(0, 500) : null,
    ...iso(x.nudgedAt) ? { nudgedAt: iso(x.nudgedAt) } : {},
    ...finishedOf(x.finishedAt, now) ? { finishedAt: finishedOf(x.finishedAt, now) } : {},
    ...title ? { title } : {},
    ...typeof x.sha === "string" && /^[0-9a-f]{7,40}$/i.test(x.sha) ? { sha: x.sha } : {}
  };
}
function normalizeExecution(x, now) {
  if (!isObj2(x)) return null;
  const mode = oneOf2(["subagents", "sessions"], x.mode);
  const kind = oneOf2(["plan", "ephemeral"], x.kind) ?? "plan";
  const runId = str2(x.runId), project = str2(x.project), base = str2(x.base), branch = str2(x.branch), coordinator = str2(x.coordinator);
  const startedAt = iso(x.startedAt);
  if (!mode || !runId || !project || !base || !branch || !coordinator || !startedAt) return null;
  if (!isSafeId(runId) || !isSafeId(coordinator) || !isRunBranch(branch)) return null;
  const tasks = {};
  if (isObj2(x.tasks)) {
    for (const [id2, t] of Object.entries(x.tasks).slice(0, MAX_TASKS)) {
      const n2 = isPlanId(id2) ? normalizeTask(t, now) : null;
      if (n2) tasks[id2] = n2;
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
    parallel: int3(x.parallel, 1, 10, 3),
    mergeOnFinish: x.mergeOnFinish === true,
    hookSession: isSafeId(x.hookSession) ? x.hookSession : null,
    active: x.active === true,
    stopReason: oneOf2(STOPS, x.stopReason),
    stallReason: typeof x.stallReason === "string" ? x.stallReason.slice(0, 1e3) : null,
    lastStepAt: iso(x.lastStepAt),
    lastBlockStep: iso(x.lastBlockStep),
    sleepUntil: iso(x.sleepUntil),
    // C2: closedBy only means something with a closedAt; an older file has neither.
    closedAt: iso(x.closedAt),
    closedBy: iso(x.closedAt) ? oneOf2(["merge", "close"], x.closedBy) : null,
    ...typeof x.planned === "number" && Number.isInteger(x.planned) ? { planned: Math.min(MAX_TASKS, Math.max(0, x.planned)) } : {},
    ...x.autonomy === "auto" ? { autonomy: "auto" } : {},
    ...isLocale(x.locale) ? { locale: x.locale } : {}
  };
}
function parseExecution(text2, now) {
  if (typeof text2 !== "string") return null;
  try {
    return normalizeExecution(JSON.parse(text2), now);
  } catch {
    return null;
  }
}
function normalizePublicTask(x) {
  if (!isObj2(x)) return null;
  const task = str2(x.task), runId = str2(x.runId), by = str2(x.by);
  const stage = oneOf2(STAGES, x.stage), status = oneOf2(TASK_STATUSES, x.status), mode = oneOf2(["subagents", "sessions", "manual"], x.mode);
  const since = iso(x.since), updatedAt = iso(x.updatedAt), leaseUntil = iso(x.leaseUntil);
  if (!task || !isPlanId(task) || !runId || !by || !stage || !status || !mode || !since || !updatedAt || !leaseUntil) return null;
  return { task, runId, stage, status, mode, by, since, updatedAt, leaseUntil, agent: str2(x.agent), round: int3(x.round, 0, 99, 0) };
}
var LIVE_SILENT_MINUTES = 7;
var LIVE_STOPPED_MINUTES = 12;
var LIVE_MAX_AGE_HOURS = 24;
var FORGE_DOC_MAX_BYTES = 8 * 1024;
function normalizeLive(x) {
  if (!isObj2(x)) return null;
  const sessionId2 = str2(x.sessionId), ts = iso(x.ts);
  const role = oneOf2(["coordinator", "executor", "manual"], x.role);
  if (!sessionId2 || !ts || !role) return null;
  const agents = Array.isArray(x.agents) ? x.agents.filter(isObj2).map((a) => ({ id: str2(a.id), type: str2(a.type) ?? "", since: iso(a.since) })).filter((a) => !!a.id && !!a.since).slice(0, 20) : [];
  return { sessionId: sessionId2, role, ts, agents, runId: str2(x.runId), task: str2(x.task), event: (str2(x.event) ?? "").slice(0, 40), ended: x.ended === true };
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
var isBoundVia = (x) => BOUND_VIAS.includes(x);
var isEndReason = (x) => BOUND_END_REASONS.includes(x);
function date(x, now) {
  if (typeof x !== "string") return null;
  const t = Date.parse(x);
  if (!Number.isFinite(t)) return null;
  return now !== void 0 && Number.isFinite(now) && t - now > FUTURE_SKEW_MS2 ? null : x;
}
function normalizeBound(x, now) {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const o = x;
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
function parseBound(text2, now) {
  if (typeof text2 !== "string" || !text2 || text2.length > BOUND_MAX_BYTES) return null;
  try {
    return normalizeBound(JSON.parse(text2), now);
  } catch {
    return null;
  }
}

// src/lib/execution-view.ts
var FUTURE_TOLERANCE_MS = 2 * 6e4;
var AGENT_ALIVE_MS = 3 * 36e5;
var STALE_RUN_TTL_MS = 24 * 36e5;
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
  const age2 = Math.max(0, now - t);
  return age2 < LIVE_SILENT_MINUTES * 6e4 ? "alive" : age2 < LIVE_STOPPED_MINUTES * 6e4 ? "silent" : "stopped";
}
var freshSignal = (d, now) => {
  const t = usable(d.ts, now);
  return t !== null && now - t < LIVE_MAX_AGE_HOURS * 36e5;
};
function coordinatorOf(e, live, now, stepAt) {
  const signal = live.filter((d) => freshSignal(d, now) && d.role === "coordinator" && d.runId === e.runId && (!e.hookSession || d.sessionId === e.hookSession)).reduce((best, d) => !best || Date.parse(d.ts) > Date.parse(best.ts) ? d : best, null);
  const candidates = [signal?.ts ?? null, stepAt].map((ts) => ({ ts, t: usable(ts, now) })).filter((c2) => c2.t !== null);
  const lastSeen = candidates.length ? candidates.reduce((a, b) => b.t > a.t ? b : a).ts : null;
  const waiting = !!e.active && !!signal && !signal.ended && signal.agents.some((a) => {
    const t = usable(a.since, now);
    return t !== null && now - t < AGENT_ALIVE_MS;
  });
  const liveness2 = !e.active ? "stopped" : signal?.ended ? "stopped" : waiting ? "alive" : signalLiveness(lastSeen, false, now);
  return { signal, lastSeen, waiting, liveness: liveness2 };
}
function coordinatorLiveness(e, signal, now, activity2 = {}) {
  if (e.active && !e.hookSession) return "stopped";
  const own = e.hookSession && signal?.sessionId === e.hookSession ? signal : null;
  if (own?.ended === true) return "stopped";
  const open = !!e.hookSession && (activity2.bindings ?? []).some((b) => b.claude === e.hookSession && bindingLive(b, now));
  return e.active && (open || activity2.busy === true) ? "alive" : coordinatorOf(e, own ? [own] : [], now, lastMovedAt(e)).liveness;
}
function coordinatorGone(e, signal, now, activity2 = {}) {
  if (!e) return false;
  if (e.hookSession && signal?.sessionId === e.hookSession && signal.ended === true) return true;
  return e.active && coordinatorLiveness(e, signal, now, activity2) === "stopped";
}
function executionView(i) {
  const e = i.exec;
  if (!e || !isVisibleRun(e, i.now, i.role ?? "none")) return null;
  const fresh = (d) => freshSignal(d, i.now);
  const { signal, lastSeen, waiting, liveness: coord } = coordinatorOf(e, i.live, i.now, e.lastStepAt);
  const rank = { stopped: 0, silent: 1, alive: 2 };
  const memberLiveness = (p) => {
    const d = i.live.filter((x) => fresh(x) && x.sessionId === p.by && x.runId === e.runId).reduce((best, x) => !best || Date.parse(x.ts) > Date.parse(best.ts) ? x : best, null);
    if (d?.ended) return "stopped";
    const lease = liveness(i.now, p.leaseUntil);
    const sig = d ? signalLiveness(d.ts, false, i.now) : null;
    return sig && rank[sig] > rank[lease] ? sig : lease;
  };
  const isMember = (p) => p.mode !== "subagents" && p.by !== e.coordinator;
  const ids = (status) => Object.keys(e.tasks).filter((id2) => e.tasks[id2].status === status);
  const slots = ids("running").sort((a, b) => Date.parse(e.tasks[a].startedAt) - Date.parse(e.tasks[b].startedAt)).map((id2) => {
    const t = e.tasks[id2];
    const p = i.tasks[id2] && i.tasks[id2].runId === e.runId ? i.tasks[id2] : null;
    const agent = p ? p.agent : t.agent;
    return {
      task: id2,
      title: i.titles?.[id2] ?? t.title ?? null,
      stage: p?.stage ?? t.stage,
      agent,
      round: p?.round ?? t.round,
      since: p?.since ?? t.stageSince,
      liveness: p && isMember(p) ? memberLiveness(p) : agent && waiting ? "alive" : p ? liveness(i.now, p.leaseUntil) : coord,
      mode: p?.mode ?? t.executor,
      by: p?.by ?? null,
      startedAt: t.startedAt
    };
  });
  const manual = Object.values(i.tasks).filter((p) => p.runId === e.runId && p.mode === "manual" && p.status === "running" && !e.tasks[p.task]).sort((a, b) => Date.parse(a.since) - Date.parse(b.since)).slice(0, 10).map((p) => ({ task: p.task, title: i.titles?.[p.task] ?? null, stage: p.stage, agent: p.agent, round: p.round, since: p.since, liveness: memberLiveness(p), mode: "manual", by: p.by, startedAt: null }));
  const finished2 = Object.entries(e.tasks).filter(([, t]) => (t.status === "integrated" || t.status === "blocked") && !!t.finishedAt && Number.isFinite(Date.parse(t.finishedAt))).sort((a, b) => Date.parse(b[1].finishedAt) - Date.parse(a[1].finishedAt)).slice(0, 3).map(([task, t]) => ({ task, startedAt: t.startedAt, finishedAt: t.finishedAt }));
  return {
    runId: e.runId,
    mode: e.mode,
    parallel: e.parallel,
    branch: e.branch,
    active: e.active,
    stopReason: e.stopReason,
    stallReason: e.stallReason,
    coordinator: { liveness: coord, lastSeen },
    integrated: ids("integrated").length,
    total: Math.max(e.planned ?? 0, Object.keys(e.tasks).length),
    slots,
    queued: ids("accepted"),
    conflicts: ids("conflict"),
    blocked: ids("blocked"),
    manual,
    orphans: [...slots, ...manual].filter((s) => s.liveness === "stopped").map((s) => s.task),
    agents: signal?.agents ?? [],
    startedAt: e.startedAt,
    finished: finished2,
    frozenAt: e.active ? null : lastMovedAt(e),
    sleepUntil: e.sleepUntil ?? null
  };
}

// src/lib/member-doc.ts
var isMemberId = (s) => isSafeId(s);
var MEMBERS_MAX = 50;
function newestMemberFiles(files) {
  return files.filter((f) => f.name.endsWith(".json") && isMemberId(f.name.slice(0, -5)) && f.size <= FORGE_DOC_MAX_BYTES).sort((a, b) => b.mtimeMs - a.mtimeMs || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).slice(0, MEMBERS_MAX);
}
function normalizeMember(x) {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const o = x;
  const sessionId2 = typeof o.sessionId === "string" && isMemberId(o.sessionId) ? o.sessionId : null;
  const role = o.role === "executor" || o.role === "manual" ? o.role : null;
  const runId = typeof o.runId === "string" && o.runId ? o.runId.slice(0, 120) : null;
  const since = typeof o.since === "string" && !Number.isNaN(Date.parse(o.since)) ? o.since : null;
  if (!sessionId2 || !role || !runId || !since) return null;
  const task = typeof o.task === "string" && isPlanId(o.task) ? o.task : null;
  const name = typeof o.name === "string" && o.name ? o.name.slice(0, 80) : null;
  const hookSession = typeof o.hookSession === "string" && isMemberId(o.hookSession) ? o.hookSession : null;
  return { sessionId: sessionId2, role, runId, task, name, since, hookSession };
}

// src/lib/forge-activity.ts
function memberOfHook(members, sessionId2, runId) {
  const byHook = members.find((m) => m.runId === runId && m.hookSession === sessionId2);
  if (byHook) return byHook;
  const direct = members.find((m) => m.sessionId === sessionId2);
  return direct && direct.runId === runId && (direct.hookSession === null || direct.hookSession === sessionId2) ? direct : null;
}

// src/lib/viewer-role.ts
var PREVIOUS_OFFER_MS = 24 * 36e5;
var NONE = { role: "none", subject: null, binding: null, member: null, coordinator: false, since: null, task: null };
var time = (s) => {
  const t = s ? Date.parse(s) : NaN;
  return Number.isFinite(t) ? t : -Infinity;
};
var newest = (list, at) => list.reduce((best, b) => !best || at(b) > at(best) ? b : best, null);
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
    const own = newest(list.filter((b) => b.claude === sid), (b) => time(b.seenAt));
    if (own) return { ...NONE, role: "owner", subject: "binding", binding: own, since: own.since, task: taskOf(own) };
  }
  if (e && e.active && !i.coordinatorEnded && isVisibleRun(e, i.now, "other-live")) {
    return { ...NONE, role: "other-live", subject: "execution", since: lastMovedAt(e) };
  }
  if (e && (!e.active || i.coordinatorEnded) && isVisibleRun(e, i.now, "previous")) {
    return { ...NONE, role: "previous", subject: "execution", since: lastMovedAt(e) };
  }
  const others = list.filter((b) => b.claude !== sid);
  const live = newest(others.filter((b) => bindingLive(b, i.now)), (b) => time(b.seenAt));
  if (live) return { ...NONE, role: "other-live", subject: "binding", binding: live, since: live.seenAt, task: taskOf(live) };
  const offerAt = (b) => time(b.endedAt ?? b.seenAt);
  const offered = others.filter((b) => !bindingLive(b, i.now) && offerAt(b) + PREVIOUS_OFFER_MS > i.now);
  const prev = newest(offered.filter((b) => taskOf(b) !== null), offerAt) ?? newest(offered, offerAt);
  if (prev) return { ...NONE, role: "previous", subject: "binding", binding: prev, since: prev.endedAt ?? prev.seenAt, task: taskOf(prev) };
  return NONE;
}

// src/mod/model.ts
var NO_VIEWER = { role: "none", coordinator: false, runId: null };
function noneBand(locale, viewer = NO_VIEWER) {
  return locale ? { mode: "none", locale, viewer: { ...viewer } } : { mode: "none", viewer: { ...viewer } };
}
function json(text2) {
  if (text2 === void 0) return void 0;
  try {
    return JSON.parse(text2);
  } catch {
    return void 0;
  }
}
function parsed(rows) {
  const out = {};
  for (const [id2, text2] of Object.entries(rows)) {
    const v = json(text2);
    if (v && typeof v === "object") out[id2] = v;
  }
  return out;
}
function pickProject(entries, sessionId2) {
  if (!entries.length) return null;
  const time2 = (s) => {
    const t = s ? Date.parse(s) : NaN;
    return Number.isFinite(t) ? t : -Infinity;
  };
  const at = (b) => Math.max(time2(b.seenAt), time2(b.endedAt));
  const activity2 = (e) => Math.max(e.mtimeMs, ...e.bindings.map(at));
  const ownAt = (e) => Math.max(-Infinity, ...e.bindings.filter((b) => b.claude === sessionId2).map(at));
  const own = sessionId2 ? entries.filter((e) => ownAt(e) > -Infinity) : [];
  const score = (e) => own.length ? [ownAt(e), activity2(e)] : [activity2(e)];
  const better = (a, b) => {
    const sa = score(a), sb = score(b);
    for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sb[i] > sa[i] ? 1 : -1;
    return 0;
  };
  return [...own.length ? own : entries].sort(better)[0].name;
}
function checkoutSidOf(session, bound, now) {
  const named = json(session)?.sessionId;
  return typeof named === "string" && named ? named : parseBound(bound, now)?.sid ?? null;
}
function seatsOf(f, now) {
  const texts = f.bindings ?? {};
  const checkoutBound = parseBound(texts["."], now);
  const sid = checkoutSidOf(f.session, texts["."], now);
  const out = [];
  if (sid !== null && isSafeId(sid)) out.push({ sid, checkout: true, bound: checkoutBound?.sid === sid ? checkoutBound : null, session: f.session });
  const extra = Object.keys(texts).filter((k) => k !== "." && k !== sid && isSafeId(k)).sort().slice(0, MAX_SEATS);
  for (const k of extra) {
    const b = parseBound(texts[k], now);
    out.push({ sid: k, checkout: false, bound: b?.sid === k ? b : null, session: f.seatSessions?.[k] });
  }
  return out;
}
function openTasksFrom(states) {
  const open = /* @__PURE__ */ new Map();
  for (const id2 of Object.keys(states).sort()) {
    const s = states[id2];
    if ((s?.status === "claimed" || s?.status === "in_progress") && typeof s.owner === "string" && !open.has(s.owner)) open.set(s.owner, id2);
  }
  return Object.fromEntries(open);
}
function ownSeat(seats, sessionId2) {
  if (!isSafeId(sessionId2)) return null;
  const own = seats.filter((s) => s.bound?.claude === sessionId2 && !s.bound.endedAt).sort((a, b) => Date.parse(b.bound.seenAt) - Date.parse(a.bound.seenAt))[0];
  return own?.sid ?? null;
}
function seatSignals(f, sid) {
  const messages = parsed(f.messages);
  return {
    inbox: inboxFor(messages, sid).length,
    escalation: Object.values(messages).some((x) => x.type === "escalation" && x.status === "open" && (x.from === sid || x.to === sid)) || escalationCandidates(messages).some((c2) => c2.sessions.includes(sid))
  };
}
function planProgress(plan, f, now) {
  if (!plan) return { percent: 0, phase: null };
  const m = computeMetrics(plan, parsed(f.states), now);
  const pi = plan.phases.findIndex((p) => m.byPhase[p.id]?.status !== "done");
  return { percent: m.percent, phase: pi >= 0 ? { index: pi + 1, total: plan.phases.length, name: plan.phases[pi].name } : null };
}
function projectExecution(project, f, now) {
  const e = parseExecution(f.execution, now);
  return e && (e.kind === "ephemeral" || e.project === project) ? e : null;
}
function membersOf(f, runId) {
  return Object.values(f.members ?? {}).flatMap((text2) => {
    const m = normalizeMember(json(text2));
    return m && m.runId === runId ? [m] : [];
  });
}
function viewerOf(v, exec, now) {
  const ownsRun = v.role === "owner" && v.subject === "execution";
  const runId = exec && v.subject === "execution" && isVisibleRun(exec, now, ownsRun ? "owner" : "none") ? exec.runId : null;
  return { role: v.role, coordinator: v.coordinator, runId };
}
function runInput(exec, f, now) {
  const bindings = Object.values(f.coordinatorBindings ?? {}).flatMap((text2) => {
    const b = parseBound(text2, now);
    return b ? [b] : [];
  });
  return { execution: exec, members: exec ? membersOf(f, exec.runId) : [], coordinatorEnded: coordinatorGone(exec, normalizeLive(json(f.coordinatorLive)), now, { bindings }) };
}
function forgeViewer(exec, f, now) {
  return viewerOf(describeViewer({ bound: null, ...runInput(exec, f, now), sessionId: isSafeId(f.sessionId) ? f.sessionId : null, now }), exec, now);
}
function executionViewer(f) {
  const now = f.now ?? Date.now();
  try {
    return forgeViewer(parseExecution(f.execution, now), f, now);
  } catch {
    return { ...NO_VIEWER };
  }
}
function buildBandModel(project, f) {
  const now = f.now ?? Date.now();
  try {
    let plan = null;
    try {
      if (f.plan !== void 0) plan = parsePlan(f.plan);
    } catch {
      plan = null;
    }
    const exec = projectExecution(project, f, now);
    const seats = seatsOf(f, now);
    const sessionId2 = isSafeId(f.sessionId) ? f.sessionId : null;
    const states = parsed(f.states);
    const v = describeViewer({
      bound: seats.flatMap((s) => s.bound ? [s.bound] : []),
      ...runInput(exec, f, now),
      sessionId: sessionId2,
      now,
      openTasks: openTasksFrom(states)
    });
    const viewer = viewerOf(v, exec, now);
    if (v.coordinator && exec) {
      const r = runModel(project, f, exec, plan, now, viewer, ownSeat(seats, f.sessionId) ?? exec.coordinator);
      if (r) return withAuto(r, f, now);
    }
    if (f.plan === void 0 && f.design === void 0) return noneBand(knownLocale(f), forgeViewer(exec, f, now));
    if (f.plan !== void 0 && !plan) return noneBand(knownLocale(f));
    if (sessionId2 === null) return noneBand(knownLocale(f), viewer);
    const m = roleBand(project, f, plan, states, v, exec, seats, now, viewer);
    if (m) return withAuto(m, f, now);
    return noneBand(knownLocale(f), viewer);
  } catch {
  }
  return noneBand(knownLocale(f));
}
function roleBand(project, f, plan, states, v, exec, seats, now, viewer) {
  if (v.role === "owner" && v.member && exec) {
    if (!plan) return null;
    const m = v.member;
    return workModel(project, f, plan, states, { sid: m.sessionId, ...seatInfo(seats, m.sessionId), task: m.task, since: m.since, run: memberLine(project, m, f, exec) }, now, viewer);
  }
  if (v.role === "owner" && v.binding) {
    const b = v.binding;
    if (b.via === "design") return f.design !== void 0 ? designModel(project, f, viewer) : null;
    if (!plan) return null;
    return workModel(project, f, plan, states, { sid: b.sid, ...seatInfo(seats, b.sid), task: null, since: null, run: memberRun(project, b.sid, f, exec) }, now, viewer);
  }
  if (v.role === "other-live" || v.role === "previous") return noticeModel(project, f, plan, v, exec, now, viewer);
  return null;
}
function noticeModel(project, f, plan, v, exec, now, viewer) {
  const kind = v.role === "previous" ? "previous" : "other-live";
  const base = { mode: "notice", project, locale: plan?.locale ?? knownLocale(f) ?? "en", kind, since: v.since, roadmapUrl: plan?.artifacts.roadmap ?? null, viewer };
  const titleOf = (t) => t && plan ? plan.tasks.find((x) => x.id === t)?.title ?? null : null;
  if (v.subject === "execution") {
    if (!exec) return null;
    const view = executionView({ exec, tasks: publicTasks(f), live: lives(f), now, role: kind });
    if (!view) return null;
    return {
      ...base,
      subject: "run",
      seat: null,
      task: null,
      title: null,
      runId: exec.runId,
      integrated: view.integrated,
      total: view.total,
      stopReason: exec.active ? null : exec.stopReason,
      joinable: exec.active && exec.kind === "plan",
      key: `run:${exec.runId}`
    };
  }
  const b = v.binding;
  if (!b) return null;
  if (kind === "other-live") {
    if (!plan) return null;
    if (b.via === "design") return { ...base, subject: "design", seat: b.sid, task: null, title: null, runId: null, key: `design:${project}` };
    return { ...base, subject: "task", seat: b.sid, task: v.task, title: titleOf(v.task), runId: null, key: v.task ? `task:${v.task}` : `seat:${b.sid}` };
  }
  if (b.via === "design") return isDraft(f) ? { ...base, subject: "design", seat: b.sid, task: null, title: null, runId: null, key: `design:${project}` } : null;
  if (!v.task || !plan) return null;
  return { ...base, subject: "task", seat: b.sid, task: v.task, title: titleOf(v.task), runId: null, key: `task:${v.task}` };
}
function isDraft(f) {
  try {
    return f.design !== void 0 && parseDesign(f.design).meta.status === "draft";
  } catch {
    return false;
  }
}
function withAuto(m, f, now) {
  if (m.mode === "none" || m.mode === "notice") return m;
  const s = decisionsSummary(f.decisions, now);
  return s ? { ...m, auto: { count: s.count, lastMajor: s.lastMajor } } : m;
}
function knownLocale(f) {
  try {
    if (f.plan !== void 0) return parsePlan(f.plan).locale;
  } catch {
  }
  try {
    if (f.design !== void 0) return parseDesign(f.design).meta.locale;
  } catch {
  }
  return void 0;
}
var MAX_CELLS = 120;
var BAND_SLOTS_MAX = 12;
var CELL = { done: "d", in_progress: "a", claimed: "a", blocked: "b", free: "p", orphaned: "b" };
var RECENT_DONE = 3;
var SKEW_MS = 2 * 6e4;
function recentDone(tasks, states, now) {
  const out = [];
  for (const t of tasks) {
    const s = states[t.id];
    if (s?.status !== "done") continue;
    const end = Date.parse(s.doneAt ?? "");
    const start = Date.parse(s.startedAt ?? s.claimedAt ?? "");
    if (!Number.isFinite(end) || !Number.isFinite(start) || end - now > SKEW_MS || end < start) continue;
    out.push({ id: t.id, minutes: Math.floor((end - start) / 6e4), ...t.estimate_min ? { estimateMin: t.estimate_min } : {}, at: end });
  }
  return out.sort((a, b) => b.at - a.at).slice(0, RECENT_DONE).map(({ at: _at, ...r }) => r);
}
function seatInfo(seats, sid) {
  const s = json(seats.find((x) => x.sid === sid)?.session) ?? {};
  return { track: typeof s.track === "string" ? s.track : null, swarm: typeof s.launchedBy === "string" && !!s.launchedBy };
}
function workModel(project, f, plan, states, seat, now, viewer) {
  const { sid, track } = seat;
  const m = computeMetrics(plan, states, now);
  const own = seat.task ? plan.tasks.find((t) => t.id === seat.task) : plan.tasks.find((t) => states[t.id]?.owner === sid && ["claimed", "in_progress"].includes(states[t.id]?.status ?? ""));
  const byTrack = track ? m.byTrack[track] : void 0;
  const phaseAt = own ? plan.phases.findIndex((p) => p.id === own.phase) : -1;
  const pi = phaseAt >= 0 ? phaseAt : plan.phases.findIndex((p) => m.byPhase[p.id]?.status !== "done");
  return {
    mode: "work",
    project,
    locale: plan.locale,
    sid,
    track,
    roadmapUrl: plan.artifacts.roadmap ?? null,
    current: own ? { id: own.id, title: own.title, startedAt: states[own.id]?.startedAt ?? seat.since ?? void 0, estimateMin: own.estimate_min } : null,
    trackDone: byTrack?.done ?? m.done,
    trackTotal: byTrack?.total ?? m.total,
    percent: m.percent,
    ...seatSignals(f, sid),
    phase: pi >= 0 ? { index: pi + 1, total: plan.phases.length, name: plan.phases[pi].name } : null,
    cells: plan.tasks.filter((t) => !track || t.track === track).slice(0, MAX_CELLS).map((t) => CELL[states[t.id]?.status ?? "free"] ?? "p").join(""),
    swarm: seat.swarm,
    run: seat.run,
    recentDone: recentDone(plan.tasks.filter((t) => !track || t.track === track), states, now),
    viewer
  };
}
function memberRun(project, sid, f, exec) {
  if (!exec || !exec.active || exec.project !== project) return null;
  for (const t of Object.values(f.execTasks ?? {})) {
    const p = normalizePublicTask(json(t));
    if (p && p.by === sid && p.runId === exec.runId) return { coordinator: exec.coordinator, stage: p.stage };
  }
  return null;
}
function memberLine(project, m, f, exec) {
  return memberRun(project, m.sessionId, f, exec) ?? { coordinator: exec.coordinator, stage: (m.task ? exec.tasks[m.task]?.stage : void 0) ?? "execution" };
}
var publicTasks = (f) => {
  const out = {};
  for (const [id2, t] of Object.entries(f.execTasks ?? {})) {
    const p = normalizePublicTask(json(t));
    if (p && p.task === id2) out[id2] = p;
  }
  return out;
};
var lives = (f) => Object.values(f.live ?? {}).map((t) => normalizeLive(json(t))).filter((d) => d !== null);
function runModel(project, f, exec, plan, now, viewer, sid) {
  const v = executionView({ exec, tasks: publicTasks(f), live: lives(f), now, role: "owner" });
  if (!v) return null;
  const rank = { alive: 0, silent: 1, stopped: 2 };
  const worst = [v.coordinator.liveness, ...v.slots.map((s) => s.liveness)].reduce((a, b) => rank[b] > rank[a] ? b : a, "alive");
  return {
    mode: "run",
    project,
    locale: plan?.locale ?? "en",
    executor: v.mode,
    running: v.slots.length,
    parallel: v.parallel,
    integrated: v.integrated,
    total: v.total,
    queued: v.queued.length,
    slots: v.slots.slice(0, BAND_SLOTS_MAX).map((s) => ({ task: s.task, stage: s.stage, round: s.round })),
    worst,
    stalled: !v.active,
    roadmapUrl: plan?.artifacts.roadmap ?? null,
    viewer,
    // E-10: what the roadmap card shows for a run too: the seat's messages and decision, the plan's progress and phase.
    sid,
    ...seatSignals(f, sid),
    ...planProgress(plan, f, now)
  };
}
function designModel(project, f, viewer) {
  const d = parseDesign(f.design);
  if (d.meta.status !== "draft") return noneBand(d.meta.locale, viewer);
  let changelog = [];
  try {
    changelog = parseChangelog(f.changelog ?? null);
  } catch {
    changelog = [];
  }
  const critiques = Object.entries(f.critiques).map(([name, text2]) => ({ n: Number(/^critique-r(\d+)\.json$/.exec(name)?.[1] ?? NaN), text: text2 })).filter((c2) => Number.isFinite(c2.n)).sort((a, b) => b.n - a.n);
  const valid = critiques.map((c2) => {
    try {
      return { round: c2.n, critique: parseCritique(c2.text) };
    } catch {
      return { round: c2.n, critique: null };
    }
  });
  const top = valid.find((c2) => c2.critique !== null);
  const latest = top?.critique ?? null;
  const pending = pendingProposals(changelog, valid, parseDismissed(f.dismissed));
  return {
    mode: "design",
    project,
    locale: d.meta.locale,
    version: changelog.at(-1)?.version ?? 0,
    round: top?.round ?? 0,
    proposals: latest?.proposals.length ?? 0,
    critical: latest?.proposals.filter((p) => p.severity === "critical").length ?? 0,
    pending: pending.length,
    pendingCritical: pending.filter((p) => p.severity === "critical").length,
    designUrl: d.meta.artifact ?? null,
    viewer
  };
}

// src/lib/sha256.ts
var K = new Uint32Array([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);

// src/lib/proposals.ts
var PROPOSAL_CATEGORIES = ["feature", "security", "perf", "quality", "tests", "deps"];
var PROPOSAL_RISKS = ["low", "medium", "high"];
var PROPOSAL_STATUSES = ["proposed", "approved", "rejected", "discussing", "auto_approved", "done"];
var MAX_PROPOSAL_TEXT = 4e3;
var MAX_PROPOSAL_TITLE = 200;
var MAX_PROPOSAL_HISTORY = 20;
var str3 = (x) => typeof x === "string";
var oneOf3 = (list, x) => str3(x) && list.includes(x);
function clipWords(s, max) {
  const chars = Array.from(s);
  if (chars.length <= max) return s;
  let space = -1;
  for (let i = Math.min(max - 1, chars.length - 1); i >= 0; i--) if (/\s/.test(chars[i])) {
    space = i;
    break;
  }
  const hard = chars.slice(0, max - 1).join("");
  if (space < Math.floor((max - 1) * 0.7)) return hard + "\u2026";
  const soft = chars.slice(0, space).join("").replace(/[\s.,;:!?¡¿…\-–—]+$/u, "");
  return (soft || hard) + "\u2026";
}
function normalizeProposal(x) {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const o = x;
  if (!oneOf3(PROPOSAL_CATEGORIES, o.category) || !oneOf3(PROPOSAL_RISKS, o.risk) || !oneOf3(PROPOSAL_STATUSES, o.status)) return null;
  if (o.source !== "scout" && o.source !== "user") return null;
  if (!str3(o.title) || !o.title.trim() || !str3(o.author)) return null;
  const text2 = (v, max = MAX_PROPOSAL_TEXT) => str3(v) ? clipWords(v, max) : "";
  const line = (v) => str3(v) ? clipWords(v.replace(/[\s\x85]+/g, " ").trim(), MAX_PROPOSAL_TITLE) : "";
  const out = {
    ts: str3(o.ts) ? o.ts : "",
    category: o.category,
    risk: o.risk,
    title: line(o.title),
    rationale: text2(o.rationale),
    evidence: text2(o.evidence),
    pillar: line(o.pillar),
    status: o.status,
    source: o.source,
    author: o.author
  };
  for (const k of ["estimate", "path", "decidedBy", "decidedAt"]) if (str3(o[k])) out[k] = o[k].slice(0, MAX_PROPOSAL_TITLE);
  if (str3(o.taskId) && /^[A-Za-z0-9_.-]{1,64}$/.test(o.taskId)) out.taskId = o.taskId;
  if (str3(o.reason)) out.reason = clipWords(o.reason, MAX_PROPOSAL_TEXT);
  if (Array.isArray(o.history)) {
    const history = o.history.map(normalizeHistoryEntry).filter((e) => e !== null).slice(-MAX_PROPOSAL_HISTORY);
    if (history.length) out.history = history;
  }
  return out;
}
function normalizeHistoryEntry(x) {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const o = x;
  if (!oneOf3(PROPOSAL_STATUSES, o.status) || !str3(o.reopenedBy) || !str3(o.reopenedAt)) return null;
  const e = { status: o.status, reopenedBy: o.reopenedBy.slice(0, MAX_PROPOSAL_TITLE), reopenedAt: o.reopenedAt.slice(0, MAX_PROPOSAL_TITLE) };
  if (str3(o.decidedBy)) e.decidedBy = o.decidedBy.slice(0, MAX_PROPOSAL_TITLE);
  if (str3(o.decidedAt)) e.decidedAt = o.decidedAt.slice(0, MAX_PROPOSAL_TITLE);
  if (str3(o.reason)) e.reason = clipWords(o.reason, MAX_PROPOSAL_TEXT);
  return e;
}

// src/lib/forge-status.ts
var CLIP = 80;
var MAX_VALIDATORS = 10;
var MAX_ACCEPTED = 200;
var MAX_STAGES = 20;
var MAX_TS = 40;
var MAX_REVIEWERS = 6;
var MAX_SKIPPED = 10;
var MAX_REVIEWS = 20;
var MAX_FINDINGS = 999;
var tsText = (x) => str4(x) && x.length <= MAX_TS ? x : null;
function stagesOf(x) {
  const out = /* @__PURE__ */ Object.create(null);
  if (!isObj3(x)) return out;
  for (const [k, v] of Object.entries(x)) {
    if (Object.keys(out).length >= MAX_STAGES) break;
    const key = cleanText(k).toLowerCase();
    if (!key || typeof v !== "number" || !Number.isFinite(v) || v < 0) continue;
    out[key] = Math.round(v);
  }
  return out;
}
var str4 = (x) => typeof x === "string";
var num = (x) => typeof x === "number" && Number.isFinite(x) ? x : null;
var isObj3 = (x) => !!x && typeof x === "object" && !Array.isArray(x);
var cp2 = (n2) => String.fromCharCode(n2);
var UNSAFE2 = new RegExp(`[\\x00-\\x1f\\x7f-\\x9f${cp2(8234)}-${cp2(8238)}${cp2(8294)}-${cp2(8297)}]`, "g");
var cleanText = (s) => s.replace(UNSAFE2, "").slice(0, CLIP);
var pathText = (x) => str4(x) ? x.replace(/[\x00-\x1f\x7f-\x9f]/g, "").slice(0, 200) : null;
var briefNum = (x) => typeof x === "number" && Number.isInteger(x) && x > 0 && x < 1e4 ? x : null;
var roundOf = (v) => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= MAX_REVIEWS ? v : null;
var reviewsOf = (x) => {
  if (!isObj3(x)) return null;
  const n2 = roundOf(x.n), max = roundOf(x.max);
  return n2 !== null && max !== null ? { n: n2, max } : null;
};
var countOf = (v) => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MAX_FINDINGS ? v : null;
var findingsOf = (x) => {
  const critical = countOf(x.critical), important = countOf(x.important), minor = countOf(x.minor);
  return critical !== null && important !== null && minor !== null ? { critical, important, minor } : null;
};
function normalizeStatus(x) {
  if (!isObj3(x) || !str4(x.ts) || !str4(x.task) || !x.task || !str4(x.path) || !str4(x.phase)) return null;
  if (x.agent !== null && !str4(x.agent)) return null;
  if (!Array.isArray(x.validators)) return null;
  let verdict = null;
  if (x.verdict !== null) {
    if (!isObj3(x.verdict) || !str4(x.verdict.action)) return null;
    verdict = { action: cleanText(x.verdict.action), score: num(x.verdict.score), round: roundOf(x.verdict.round), findings: isObj3(x.verdict.findings) ? findingsOf(x.verdict.findings) : null };
  }
  return {
    ts: x.ts,
    task: isSafeId(x.task) ? x.task : cleanText(x.task),
    path: cleanText(x.path),
    phase: cleanText(x.phase),
    agent: str4(x.agent) ? cleanText(x.agent) : null,
    validators: x.validators.filter((v) => isObj3(v) && str4(v.name)).slice(0, MAX_VALIDATORS).map((v) => ({ name: cleanText(v.name), ok: v.ok === true, ...v.cached === true ? { cached: true } : {} })),
    verdict,
    round: num(x.round),
    cap: num(x.cap),
    // Absent in a status written before these fields existed.
    brief: briefNum(x.brief),
    accepted: Array.isArray(x.accepted) ? [...new Set(x.accepted.map(briefNum).filter((v) => v !== null))].sort((a, b) => a - b).slice(-MAX_ACCEPTED) : [],
    // Absent in a status written before the verify plan existed.
    verify: isObj3(x.verify) && typeof x.verify.planned === "boolean" ? {
      planned: x.verify.planned,
      surfaces: (Array.isArray(x.verify.surfaces) ? x.verify.surfaces : []).filter(str4).slice(0, MAX_VALIDATORS).map(cleanText),
      result: str4(x.verify.result) ? cleanText(x.verify.result) : null,
      passed: num(x.verify.passed),
      total: num(x.verify.total),
      evidence: pathText(x.verify.evidence),
      reason: str4(x.verify.reason) ? cleanText(x.verify.reason) : null,
      skipped: (Array.isArray(x.verify.skipped) ? x.verify.skipped : []).filter(str4).slice(0, MAX_SKIPPED).map(cleanText),
      launched: x.verify.launched === true
    } : null,
    // Absent in a status written before timings existed: no times are shown.
    taskStartedAt: tsText(x.taskStartedAt),
    stageSince: tsText(x.stageSince),
    stages: stagesOf(x.stages),
    doneAt: tsText(x.doneAt),
    lastAt: tsText(x.lastAt),
    // Absent in a status written before C4: who, which run and which project are unknown.
    session: isSafeId(x.session) ? x.session : null,
    runId: isSafeId(x.runId) ? x.runId : null,
    project: isSafeId(x.project) ? x.project : null,
    reviewers: (Array.isArray(x.reviewers) ? x.reviewers : []).filter(str4).map(cleanText).filter(Boolean).slice(0, MAX_REVIEWERS),
    reviews: reviewsOf(x.reviews),
    ...x.autonomy === "auto" ? { autonomy: "auto" } : {}
  };
}
function statusKey(task, project) {
  if (!isSafeId(task)) return null;
  if (project === null) return task;
  if (!isSafeId(project)) return null;
  const key = `${project}__${task}`;
  return isSafeId(key) ? key : null;
}

// src/lib/prices.ts
var PRICES_AS_OF = "2026-10-12";
var P = (input, output, cacheRead, cacheWrite) => ({ input, output, cacheRead, cacheWrite });
var HAIKU_55_HIGH = P(0.5, 2.5, 0.05, 1);
var HAIKU_55_TIER_TOKENS = 1e5;
var TABLE = [
  ["claude-fable-5-1", P(10, 50, 0.25, 20)],
  ["claude-mythos-5-1", P(10, 50, 0.25, 20)],
  ["claude-fable-5", P(10, 50, 1, 20)],
  ["claude-mythos-5", P(10, 50, 1, 20)],
  ["claude-opus-5-5", P(4, 20, 0.2, 8)],
  ["claude-opus-5", P(5, 25, 0.5, 10)],
  ["claude-opus-4-8", P(5, 25, 0.5, 10)],
  ["claude-opus-4-7", P(5, 25, 0.5, 10)],
  ["claude-opus-4-6", P(5, 25, 0.5, 10)],
  ["claude-opus-4-5", P(5, 25, 0.5, 10)],
  ["claude-opus-4-1", P(15, 75, 1.5, 30)],
  ["claude-opus-4", P(15, 75, 1.5, 30)],
  ["claude-sonnet-5-5", P(2, 10, 0.1, 4)],
  ["claude-sonnet-5", P(2, 10, 0.2, 4)],
  ["claude-sonnet-4", P(3, 15, 0.3, 6)],
  ["claude-haiku-5-5", P(0.1, 0.5, 0.01, 0.2)],
  ["claude-haiku-4-5", P(1, 5, 0.1, 2)],
  ["claude-haiku-3-5", P(0.8, 4, 0.08, 1.6)]
];
var baseId = (model) => model.replace(/\[[^\]]*\]$/, "").trim();
function priceFor(model, promptTokens = 0) {
  const id2 = baseId(model);
  const hit = TABLE.find(([prefix]) => id2 === prefix || id2.startsWith(`${prefix}-`) || id2.startsWith(`${prefix}[`));
  if (!hit) return null;
  if (hit[0] === "claude-haiku-5-5" && promptTokens > HAIKU_55_TIER_TOKENS) return HAIKU_55_HIGH;
  return hit[1];
}
var cost = (p, t) => {
  const w5 = Math.min(t.cacheWrite5m ?? 0, t.cacheWrite);
  return (t.input * p.input + t.output * p.output + t.cacheRead * p.cacheRead + (t.cacheWrite - w5) * p.cacheWrite + w5 * p.input * 1.25) / 1e6;
};
function stepCost(model, t) {
  const p = priceFor(model, t.input + t.cacheRead + t.cacheWrite);
  return p ? cost(p, t) : null;
}
function tokensCost(model, t) {
  const p = priceFor(model);
  return p ? cost(p, t) : null;
}
var FAMILY = /^claude-(fable|mythos|opus|sonnet|haiku)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/;
var MAX_NAME = 22;
function shortModelName(model) {
  const id2 = baseId(model);
  const m = FAMILY.exec(id2);
  if (m) return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] !== void 0 ? `.${m[3]}` : ""}`;
  return id2.length > MAX_NAME ? `${id2.slice(0, MAX_NAME)}\u2026` : id2;
}

// src/lens/usage.ts
var MAIN = "main";
var MAX_LOOPS = 200;
var OVERFLOW = "overflow";
var n = (x) => typeof x === "number" && Number.isFinite(x) && x > 0 ? x : 0;
var newUsage = (startedAt) => ({ startedAt, loops: {}, tracking: { waypoint: 0, forge: 0, reread: 0 }, rereadBase: 0, activeMs: 0 });
var newTurnClock = () => ({ since: null, lastActivityMs: 0 });
function touchTurn(c2, now) {
  if (Number.isFinite(now) && now > c2.lastActivityMs) c2.lastActivityMs = now;
}
function startTurn(s, c2, now) {
  if (c2.since !== null) closeTurn(s, c2.since, c2.lastActivityMs);
  c2.since = now;
  c2.lastActivityMs = now;
}
function endTurn(s, c2, now) {
  if (c2.since !== null) closeTurn(s, c2.since, now);
  c2.since = null;
}
function closeTurn(s, since, now) {
  if (Number.isFinite(since) && Number.isFinite(now) && now > since) s.activeMs += now - since;
}
function effortText(effort) {
  if (typeof effort === "string" && effort) return effort;
  if (typeof effort === "number" && Number.isFinite(effort)) return String(effort);
  return null;
}
function loopOf(s, id2) {
  const found = s.loops[id2];
  if (found) return found;
  if (id2 !== OVERFLOW && Object.keys(s.loops).length >= MAX_LOOPS) return loopOf(s, OVERFLOW);
  const fresh = { kind: id2 === MAIN ? "main" : "unknown", description: null, model: null, effort: null, steps: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0, unpriced: 0 };
  s.loops[id2] = fresh;
  return fresh;
}
function recordStep(s, step) {
  const loop = loopOf(s, step.agentId || MAIN);
  const model = typeof step.usage?.model === "string" && step.usage.model || step.model;
  loop.model = model;
  loop.effort = effortText(step.effort);
  loop.steps += 1;
  if ((step.agentId || MAIN) === MAIN) s.tracking.reread += Math.max(0, s.tracking.waypoint + s.tracking.forge - s.rereadBase);
  if (!step.usage) return;
  const t = { input: n(step.usage.input_tokens), output: n(step.usage.output_tokens), cacheRead: n(step.usage.cache_read_input_tokens), cacheWrite: n(step.usage.cache_creation_input_tokens) };
  loop.input += t.input;
  loop.output += t.output;
  loop.cacheRead += t.cacheRead;
  loop.cacheWrite += t.cacheWrite;
  const c2 = stepCost(model, { ...t, cacheWrite5m: n(step.usage.cache_creation?.ephemeral_5m_input_tokens) });
  if (c2 === null) loop.unpriced += 1;
  else loop.costUsd += c2;
}
function labelLoop(s, agentId, kind, description) {
  const loop = loopOf(s, agentId);
  if (loop === s.loops[OVERFLOW] && agentId !== OVERFLOW) return;
  loop.kind = kind || "unknown";
  if (description) loop.description = description.slice(0, 120);
}
var WAYPOINT_CLI = /waypoint\.cjs/;
var FORGE_CLI = /forge\.cjs/;
function trackingKind(tool, input) {
  if (tool === "ArtifactData") return "waypoint";
  if (tool === "Bash" && typeof input.command === "string") {
    if (WAYPOINT_CLI.test(input.command)) return "waypoint";
    if (FORGE_CLI.test(input.command)) return "forge";
  }
  if (tool === "Skill" && typeof input.skill === "string") {
    if (input.skill.startsWith("waypoint:")) return "waypoint";
    if (input.skill.startsWith("forge:")) return "forge";
  }
  return null;
}
function recordTracking(s, kind, chars) {
  s.tracking[kind] += Math.ceil(n(chars) / 4);
}
function compactUsage(s) {
  s.rereadBase = s.tracking.waypoint + s.tracking.forge;
}

// src/lib/duration.ts
var duration = (seconds) => seconds === null || seconds === void 0 ? null : seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s` : `${Math.floor(seconds / 3600)}h ${String(Math.floor(seconds % 3600 / 60)).padStart(2, "0")}m`;
var DAY_S = 86400;
function span(seconds) {
  if (seconds === null || seconds === void 0 || !Number.isFinite(seconds) || seconds < 0) return null;
  return seconds > DAY_S ? ">24h" : duration(Math.floor(seconds));
}
var MAX_MINUTES = 99999 * 1440;

// src/lens/view.ts
var PALETTE = {
  base: "#1e1e2e",
  mantle: "#181825",
  crust: "#11111b",
  s0: "#313244",
  s1: "#45475a",
  s2: "#585b70",
  o0: "#6c7086",
  sub: "#a6adc8",
  text: "#cdd6f4",
  lavender: "#b4befe",
  blue: "#89b4fa",
  sapphire: "#74c7ec",
  sky: "#89dceb",
  teal: "#94e2d5",
  green: "#a6e3a1",
  yellow: "#f9e2af",
  peach: "#fab387",
  red: "#f38ba8",
  mauve: "#cba6f7",
  pink: "#f5c2e7",
  flamingo: "#f2cdcd"
};
var LATTE = {
  base: "#eff1f5",
  mantle: "#e6e9ef",
  crust: "#dce0e8",
  s0: "#ccd0da",
  s1: "#bcc0cc",
  s2: "#acb0be",
  o0: "#9ca0b0",
  sub: "#6c6f85",
  text: "#4c4f69",
  lavender: "#7287fd",
  blue: "#1e66f5",
  sapphire: "#209fb5",
  sky: "#04a5e5",
  teal: "#179299",
  green: "#40a02b",
  yellow: "#df8e1d",
  peach: "#fe640b",
  red: "#d20f39",
  mauve: "#8839ef",
  pink: "#ea76cb",
  flamingo: "#dd7878"
};
var STATE_HUE = { done: "sapphire", active: "peach", blocked: "yellow", failed: "red", pending: "s2" };
var LETTER = { d: "done", a: "active", b: "blocked", p: "pending" };
var SECTION_HUE = {
  roadmap: "sapphire",
  forge: "peach",
  superpowers: "mauve",
  todos: "green",
  agents: "lavender",
  tasks: "teal",
  now: "sky"
};
var SECTION_ICON = {
  // Single-width glyphs only: some terminals draw a glyph that has an emoji form two cells wide and the title runs into it (F-13).
  roadmap: "\u25C6",
  forge: "\u25C8",
  superpowers: "\u2726",
  todos: "\u2261",
  agents: "\u25CE",
  tasks: "\u25A4",
  now: "\u25B8"
};
var TIERS = {
  "forge-mech": { label: "mech", hue: "teal", rank: 1 },
  "forge-impl-light": { label: "light", hue: "sky", rank: 2 },
  "forge-impl": { label: "impl", hue: "blue", rank: 3 },
  "forge-impl-high": { label: "high", hue: "peach", rank: 4 },
  "forge-impl-heavy": { label: "heavy", hue: "mauve", rank: 5 },
  "forge-fable": { label: "fable", hue: "pink", rank: 6 },
  "forge-review-correctness": { label: "correctness", hue: "green", rank: null },
  "forge-review-security": { label: "security", hue: "red", rank: null },
  "forge-review-perf": { label: "perf", hue: "yellow", rank: null },
  "forge-review-final": { label: "final", hue: "green", rank: null },
  "forge-verify": { label: "verify", hue: "sapphire", rank: null },
  "forge-verify-heavy": { label: "verify", hue: "sapphire", rank: null },
  "forge-planner": { label: "planner", hue: "lavender", rank: null },
  "forge-scout": { label: "scout", hue: "flamingo", rank: null },
  "design-critic": { label: "critic", hue: "flamingo", rank: null }
};
function tierOf(agent) {
  const name = String(agent ?? "").split(":").pop() ?? "";
  return TIERS[name] ?? { label: name || "?", hue: "lavender", rank: null };
}
var PATH_HUE = { trivial: "green", small: "teal", medium: "peach", large: "red" };
var STAGES2 = ["triage", "design", "plan", "execution", "implement", "validate", "verify", "review", "verdict", "final"];
var RUN_STAGES = ["design", "plan", "execution", "final"];
var STAGE_OF = {
  triage: "triage",
  design: "design",
  plan: "plan",
  planning: "plan",
  execution: "execution",
  implement: "implement",
  implementation: "implement",
  impl: "implement",
  fix: "implement",
  redo: "implement",
  validate: "validate",
  validation: "validate",
  verify: "verify",
  review: "review",
  verdict: "verdict",
  round: "verdict",
  final: "final",
  "final-review": "final",
  done: "final"
};
var stageOf = (phase) => {
  const p = String(phase).toLowerCase();
  return Object.hasOwn(STAGE_OF, p) ? STAGE_OF[p] : p;
};
function stagesFor(path, phase, validated = null, verifyPlanned = false, visited = []) {
  if (path === "run") {
    if (phase.toLowerCase() === "done") return RUN_STAGES.map((name) => ({ name, state: "done" }));
    const i2 = RUN_STAGES.indexOf(STAGE_OF[phase.toLowerCase()] ?? "execution");
    const at2 = i2 < 0 ? RUN_STAGES.indexOf("execution") : i2;
    return RUN_STAGES.map((name, k) => ({ name, state: k < at2 ? "done" : k === at2 ? "active" : "pending" }));
  }
  const large = path === "large";
  const light = path === "trivial" || path === "small";
  const names = STAGES2.filter((s) => s !== "execution" && (large || s !== "design" && s !== "plan" && s !== "final") && !(light && (s === "review" || s === "verdict")) && (s !== "verify" || verifyPlanned));
  if (phase.toLowerCase() === "done") return names.map((name) => ({ name, state: "done" }));
  if (phase.toLowerCase() === "stopped") return names.map((name) => ({ name, state: visited.includes(name) ? "done" : "pending" }));
  const at = STAGE_OF[phase.toLowerCase()] ?? null;
  let i = at ? names.indexOf(at) : -1;
  const v = names.indexOf("validate");
  if (validated && at === null) {
    if (validated === "failed") i = v;
    else if (light) return names.map((name) => ({ name, state: "done" }));
    else i = v + 1;
  }
  const out = names.map((name, k) => ({ name, state: i < 0 ? k === 0 ? "done" : "pending" : k < i ? "done" : k === i ? "active" : "pending" }));
  return out;
}
function forgePhase(f) {
  if (f.phase.toLowerCase() === "stopped") return "stopped";
  if ((f.path === "trivial" || f.path === "small") && f.timing?.done) return "done";
  if (f.timing?.done === false && f.phase.toLowerCase() === "done") return "";
  const total = Math.max(f.briefs ?? 0, f.brief ?? 0);
  const accepted = new Set(f.accepted ?? []);
  const all = total > 0 && Array.from({ length: total }, (_, i) => i + 1).every((n2) => accepted.has(n2));
  return all && f.verdict?.action === "accept" ? "done" : f.phase;
}
var count = (cells2) => ({ cells: cells2, done: cells2.filter((c2) => c2 === "done").length, total: cells2.length });
var roadmapCells = (w) => count([...w.cells ?? ""].map((ch) => LETTER[ch] ?? "pending"));
var forgeDone = (f) => f.phase.toLowerCase() !== "stopped" && (forgePhase(f) === "done" || f.timing?.done === true);
function briefCells(f) {
  const heavy = f.path === "medium" || f.path === "large";
  const done = !heavy && forgeDone(f);
  if (!heavy && !done) return null;
  const accepted = new Set(f.accepted ?? []);
  const total = Math.max(f.briefs ?? 0, f.brief ?? 0, ...accepted);
  if (total <= 0) return null;
  const sentBack = f.verdict !== null && f.verdict.action !== "accept";
  const cells2 = [];
  for (let n2 = 1; n2 <= Math.min(total, 60); n2++) {
    cells2.push(done || accepted.has(n2) ? "done" : n2 === f.brief ? sentBack && f.round ? "failed" : "active" : "pending");
  }
  return count(cells2);
}
function todoCells(t) {
  if (typeof t.cells === "string" && t.cells) {
    const cells3 = [...t.cells].slice(0, 60).map((ch) => ch === "d" ? "done" : ch === "a" ? "active" : "pending");
    return { cells: cells3, done: t.done, total: t.total };
  }
  const cells2 = [];
  const total = Math.min(t.total, 60);
  for (let i = 0; i < total; i++) cells2.push(i < t.done ? "done" : i === t.done && t.inProgress ? "active" : "pending");
  return { cells: cells2, done: t.done, total: t.total };
}
function superpowersCells(s) {
  const cells2 = [];
  const total = Math.min(s.tasks, 60);
  for (let i = 0; i < total; i++) cells2.push(i < s.done ? "done" : i === s.done ? s.current ? "failed" : "active" : "pending");
  return { cells: cells2, done: s.done, total: s.tasks };
}
var ratio = (done, total) => total > 0 ? Math.max(0, Math.min(1, done / total)) : 0;
var EIGHTHS = ["", "\u258F", "\u258E", "\u258D", "\u258C", "\u258B", "\u258A", "\u2589"];
function barParts(r, width) {
  const w = Math.max(1, Math.floor(width));
  const exact = Math.max(0, Math.min(1, r)) * w;
  const full = Math.floor(exact);
  const edge = full < w ? EIGHTHS[Math.round((exact - full) * 7)] : "";
  const fill = "\u2588".repeat(full) + edge;
  return { fill, rest: "\u2591".repeat(Math.max(0, w - full - (edge ? 1 : 0))) };
}
function short(seconds) {
  if (seconds === null || seconds === void 0 || !Number.isFinite(seconds) || seconds < 0) return null;
  const s = Math.floor(seconds);
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h ${String(Math.floor(s % 3600 / 60)).padStart(2, "0")}m`;
}
function headline(m) {
  if (m.execution?.active) {
    const x = m.execution;
    const detail = x.slots.map((s) => `${s.task} ${s.stage}`).join(" \xB7 ");
    return { section: "forge", title: `\u25BA ${x.slots.length}/${x.parallel}`, detail, cells: null, agent: null };
  }
  const expanded = (m.activities ?? []).find((a) => a.expanded);
  if (m.forge && expanded?.owner !== "other") {
    const f = m.forge;
    const c2 = briefCells(f);
    return { section: "forge", title: f.task, detail: [f.path, forgePhase(f)].filter(Boolean).join(" \xB7 "), cells: c2, agent: f.agent };
  }
  if (m.waypoint) {
    const w = m.waypoint;
    return { section: "roadmap", title: w.project, detail: w.current ? `${w.current.id} ${w.current.title}` : "", cells: roadmapCells(w), agent: null };
  }
  if (m.superpowers && !m.superpowers.stale) {
    const s = m.superpowers;
    return { section: "superpowers", title: s.plan || "superpowers", detail: s.current ? `round ${s.current.round}${s.current.cap ? `/${s.current.cap}` : ""}` : "", cells: superpowersCells(s), agent: null };
  }
  if (m.todos) return { section: "todos", title: m.todos.inProgress ?? "", detail: "", cells: todoCells(m.todos), agent: null };
  if (m.subagents.length) return { section: "agents", title: "", detail: "", cells: null, agent: m.subagents.at(-1).type };
  return null;
}
var dec = (locale) => locale.startsWith("es") ? "," : ".";
function fmtTokens(n2, locale) {
  if (n2 >= 999500) return `${(n2 / 1e6).toFixed(2).replace(".", dec(locale))} M`;
  if (n2 >= 1e3) return `${Math.round(n2 / 1e3)} k`;
  return String(Math.round(n2));
}
var usdValue = (n2, locale) => (Math.round(n2 * 100) / 100 < 10 ? n2.toFixed(2) : n2.toFixed(1)).replace(".", dec(locale));
function fmtUsd(n2, locale) {
  const v = usdValue(n2, locale);
  return locale.startsWith("es") ? `${v} $` : `$${v}`;
}
function fmtUsdRange(lo, hi, locale) {
  const a = usdValue(lo, locale), b = usdValue(hi, locale);
  return locale.startsWith("es") ? `${a}\u2013${b} $` : `$${a}\u2013${b}`;
}
function usageBandText(m) {
  const u = m.usage;
  if (!u) return null;
  const own = u.session ?? { tokens: u.tokens, costUsd: u.costUsd };
  return `${fmtTokens(own.tokens, m.locale)} tok \xB7 ${u.sessionPartial ? "\u2265 " : ""}${fmtUsd(own.costUsd, m.locale)}`;
}

// src/lens/usage-summary.ts
var ORDER = ["main", "impl", "review", "verify", "plan", "other"];
function groupOf(loopId, kind) {
  if (kind === "main" || loopId === "main" || loopId.endsWith("/main")) return "main";
  if (/forge-(impl|mech|fable)/.test(kind)) return "impl";
  if (/forge-verify/.test(kind)) return "verify";
  if (/forge-review/.test(kind)) return "review";
  if (/forge-(planner|scout)|design-critic/.test(kind)) return "plan";
  return "other";
}
var tokensOf = (l) => l.input + l.output + l.cacheRead + l.cacheWrite;
var tok = (l) => ({ input: l.input, output: l.output, cacheRead: l.cacheRead, cacheWrite: l.cacheWrite });
function dominant(loops) {
  const by = /* @__PURE__ */ new Map();
  for (const l of loops) if (l.model) by.set(l.model, (by.get(l.model) ?? 0) + tokensOf(l));
  let best = null;
  for (const [m, t] of by) if (best === null || t > by.get(best)) best = m;
  return best;
}
function summarizeUsage(s) {
  const entries = Object.entries(s.loops);
  const byGroup = /* @__PURE__ */ new Map();
  for (const [id2, l] of entries) {
    const g = groupOf(id2, l.kind);
    const list = byGroup.get(g);
    if (list) list.push(l);
    else byGroup.set(g, [l]);
  }
  const mainModel = dominant(byGroup.get("main") ?? []);
  const trackTokens = s.tracking.waypoint + s.tracking.forge;
  const trackCost = trackTokens && mainModel ? tokensCost(mainModel, { input: trackTokens, output: 0, cacheRead: 0, cacheWrite: 0 }) : null;
  const reread = s.tracking.reread ?? 0;
  const rereadCost = reread && mainModel ? tokensCost(mainModel, { input: 0, output: 0, cacheRead: reread, cacheWrite: 0 }) : null;
  const partial = entries.some(([, l]) => l.unpriced > 0) || s.runPartial === true;
  const costOf = (loops) => {
    if (loops.length && loops.every((l) => l.unpriced > 0 && l.costUsd === 0)) return null;
    return loops.reduce((a, l) => a + l.costUsd, 0);
  };
  const totalCost = entries.reduce((a, [, l]) => a + l.costUsd, 0);
  const totalTokens = entries.reduce((a, [, l]) => a + tokensOf(l), 0);
  const groups = ORDER.filter((id2) => byGroup.has(id2)).map((id2) => {
    const loops = byGroup.get(id2);
    let tokens = loops.reduce((a, l) => a + tokensOf(l), 0);
    let costUsd = costOf(loops);
    if (id2 === "main" && (trackTokens || reread)) {
      tokens = Math.max(0, tokens - trackTokens - reread);
      if (costUsd !== null) costUsd = Math.max(0, costUsd - (trackCost ?? 0) - (rereadCost ?? 0));
    }
    const models = new Set(loops.map((l) => l.model).filter(Boolean));
    const efforts = new Set(loops.filter((l) => l.steps > 0).map((l) => l.effort));
    const effort = efforts.size > 1 ? "varios" : efforts.values().next().value ?? null;
    return { id: id2, model: models.size > 1 ? "varios" : dominant(loops), effort, tokens, costUsd, share: 0 };
  });
  for (const g of groups) g.share = totalCost > 0 ? (g.costUsd ?? 0) / totalCost : totalTokens > 0 ? g.tokens / totalTokens : 0;
  const forgeLoops = ["impl", "review", "plan"].some((id2) => byGroup.has(id2));
  let withoutForge = null;
  const mainCost = costOf(byGroup.get("main") ?? []);
  if (forgeLoops && mainModel && mainCost !== null && priceFor(mainModel) !== null) {
    const repriced = [...byGroup.get("impl") ?? [], ...byGroup.get("plan") ?? []].reduce((a, l) => a + (tokensCost(mainModel, tok(l)) ?? 0), 0);
    const others = (byGroup.get("other") ?? []).reduce((a, l) => a + l.costUsd, 0);
    const without = Math.max(0, mainCost - (trackCost ?? 0) + repriced + others);
    const deltaUsd = totalCost - without;
    withoutForge = { costUsd: without, lowUsd: Math.max(0, without - (rereadCost ?? 0)), deltaUsd, deltaPct: without > 0 ? Math.round(deltaUsd / without * 100) || 0 : 0 };
  }
  return {
    tokens: totalTokens,
    costUsd: totalCost,
    partial,
    groups,
    tracking: trackTokens || reread ? { tokens: trackTokens + reread, costUsd: trackCost === null && rereadCost === null ? null : (trackCost ?? 0) + (rereadCost ?? 0) } : null,
    withoutForge
  };
}

// src/lens/finished.ts
var FINISHED_MAX = 5;
var FINISHED_TTL_MS = 5 * 6e4;
function pushFinished(list, entry) {
  return [...list.filter((x) => x.id !== entry.id), entry].slice(-FINISHED_MAX);
}
function withoutRunning(list, running) {
  const ids = new Set(running.map((s) => s.id));
  return list.filter((x) => !ids.has(x.id));
}
function freshFinished(list, now) {
  return list.filter((x) => Number.isFinite(now) && x.at <= now && now - x.at < FINISHED_TTL_MS);
}

// src/lens/activities.ts
var DONE_TTL_MS = 15 * 6e4;
var OTHER_TTL_MS = 30 * 6e4;
var OWN_TTL_MS = 24 * 36e5;
var LEFT_OPEN_MS = 30 * 6e4;
var JOB_ALIVE_MS = 2 * 36e5;
var JOB_FILE_MAX = 4 * 1024;
var JOBS_SHOWN = 5;
var CLIP2 = 80;
var PARENT_DEPTH = 5;
var ms = (s) => s ? Date.parse(s) : NaN;
var clip = (s) => s.length > CLIP2 ? s.slice(0, CLIP2) : s;
function span2(from, to, now) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(now)) return null;
  if (from - now > FUTURE_SKEW_MS2 || to - now > FUTURE_SKEW_MS2 || to < from) return null;
  return Math.floor((to - from) / 1e3);
}
var age = (t, now) => Math.max(0, now - t);
var orderAt = (t, now) => t - now > FUTURE_SKEW_MS2 ? -Infinity : Math.min(t, now);
var isOf = (task, id2) => id2 === task || id2.startsWith(`${task}-`) && /^\d{1,4}$/.test(id2.slice(task.length + 1));
var alive = (l) => l.status !== "done";
var keyOf = (task, project) => statusKey(task, project) ?? task;
function newestKey(statuses, match, now) {
  let best;
  for (const st of statuses) {
    const last = ms(st.lastAt ?? st.ts);
    if (!match(st) || !Number.isFinite(last)) continue;
    const at = orderAt(last, now);
    if (!best || at > best.at) best = { key: keyOf(st.task, st.project), at };
  }
  return best?.key;
}
function ownerOf(st, sessionId2, ownTasks2) {
  if (sessionId2 === void 0) return "own";
  if (st.session !== null && sessionId2) return st.session === sessionId2 ? "own" : "other";
  return ownTasks2.some((t) => isOf(st.task, t)) ? "own" : "other";
}
function homeOf(input, match) {
  const of = input.statuses.filter(match);
  const loose = of.find((st) => st.project === null);
  if (loose) return keyOf(loose.task, null);
  const live = (st) => !st.doneAt && st.phase.toLowerCase() !== "stopped" && ownerOf(st, input.sessionId, input.ownTasks) === "own";
  return newestKey(of, live, input.now) ?? newestKey(of, () => true, input.now);
}
function linkHomes(input) {
  const out = /* @__PURE__ */ new Map();
  for (const l of input.links) {
    const task = l.task;
    if (!task || l.workflow) continue;
    out.set(l.id, l.project !== null ? keyOf(task, l.project) : homeOf(input, (st) => st.task === task) ?? keyOf(task, null));
  }
  return out;
}
function leftOpen(st, now) {
  if (st.path !== "trivial" && st.path !== "small" || st.doneAt) return false;
  const last = ms(st.lastAt);
  return Number.isFinite(last) && Number.isFinite(now) && now - last > LEFT_OPEN_MS;
}
function runRoleOf(band) {
  const v = band.viewer;
  if (!v) return "none";
  if (v.role !== "owner") return v.role;
  return v.coordinator || band.mode === "work" && band.run != null ? "owner" : "none";
}
function parseJob(text2) {
  if (typeof text2 !== "string" || text2.length > JOB_FILE_MAX) return null;
  let o;
  try {
    o = JSON.parse(text2);
  } catch {
    return null;
  }
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  const j = o;
  if (!isSafeId(j.name) || typeof j.cmd !== "string" || !/^[a-z][a-z-]{0,39}$/.test(j.cmd)) return null;
  if (typeof j.startedAt !== "string" || !Number.isFinite(Date.parse(j.startedAt))) return null;
  if (j.task !== null && j.task !== void 0 && !isSafeId(j.task)) return null;
  return { name: j.name, cmd: j.cmd, task: isSafeId(j.task) ? j.task : null, startedAt: j.startedAt, session: isSafeId(j.session) ? j.session : null };
}
function agentOf(l, links2, models, now) {
  const m = models[l.id];
  let depth = 0;
  let up = links2.find((x) => x.id === l.parentId);
  while (up && up.task === l.task && depth < PARENT_DEPTH) {
    depth++;
    const parent = up.parentId;
    up = links2.find((x) => x.id === parent);
  }
  return {
    id: l.id,
    type: l.type,
    ...l.description ? { description: clip(l.description) } : {},
    ...m?.model ? { model: m.model } : {},
    ...m?.effort ? { effort: m.effort } : {},
    tool: l.tool?.name ?? null,
    seconds: span2(l.since, now, now),
    status: l.status === "running" ? "running" : "waiting",
    depth
  };
}
function withSlotAgents(x, links2, models, viewer, now, homes, drawn = /* @__PURE__ */ new Set()) {
  if (!x) return x;
  const project = x.project ?? null;
  const home = homes ?? linkHomes({ statuses: [], links: links2, ownTasks: [], now });
  return {
    ...x,
    slots: x.slots.map((s) => {
      const agents = links2.filter((l) => alive(l) && home.get(l.id) === keyOf(s.task, project) && !drawn.has(l.id)).map((l) => agentOf(l, links2, models, now));
      const first = agents.find((g) => g.model);
      const liveness2 = viewer.coordinator && agents.length ? "alive" : s.liveness;
      return { ...s, agents, model: s.model ?? first?.model ?? null, effort: s.effort ?? first?.effort ?? null, liveness: liveness2 };
    })
  };
}
var summary = (key, kind, o) => ({
  key,
  kind,
  owner: "own",
  dim: o.dim,
  done: o.done,
  slot: false,
  expanded: false,
  stopped: false,
  task: null,
  project: null,
  title: o.title,
  path: null,
  stage: o.stage ?? null,
  round: o.round ?? null,
  cap: o.cap ?? null,
  verdict: null,
  job: null,
  seconds: null,
  agents: []
});
function buildActivities(i) {
  const now = i.now;
  const known = i.sessionId !== void 0;
  const execProject = i.execution?.project ?? null;
  const slotTasks = new Set(i.execution?.mode === "subagents" ? i.execution.slots.map((s) => s.task) : []);
  const homes = i.homes ?? linkHomes(i);
  const liveJobs = i.jobs.filter((j) => {
    const t = ms(j.startedAt);
    return Number.isFinite(t) && age(t, now) < JOB_ALIVE_MS;
  });
  const jobHomeOf = (j) => {
    const task = j.task;
    if (task === null) return void 0;
    const own = j.session !== null ? homeOf({ ...i, statuses: i.statuses.filter((st) => st.session === j.session) }, (st) => isOf(st.task, task)) : void 0;
    return own ?? homeOf(i, (st) => isOf(st.task, task));
  };
  const jobHome = new Map(liveJobs.map((j) => [j, jobHomeOf(j)]));
  const built = [];
  const seen = /* @__PURE__ */ new Set();
  for (const st of i.statuses) {
    const key = statusKey(st.task, st.project) ?? st.task;
    if (seen.has(key)) continue;
    seen.add(key);
    const last = ms(st.lastAt ?? st.ts);
    if (!Number.isFinite(last)) continue;
    const stopped = st.phase.toLowerCase() === "stopped";
    const mine = i.links.filter((l) => alive(l) && homes.get(l.id) === key);
    const working = mine.length > 0 || !!st.agent && i.liveTypes.some((t) => tierOf(t).label === tierOf(st.agent).label);
    const left = !stopped && !working && leftOpen(st, now);
    const done = !stopped && (!!st.doneAt || left);
    const ended = st.doneAt ? ms(st.doneAt) : left ? last : NaN;
    const end = left ? last + LEFT_OPEN_MS : ended;
    const owner = ownerOf(st, i.sessionId, i.ownTasks);
    const visible2 = done || stopped ? Number.isFinite(end) && age(end, now) < DONE_TTL_MS : age(last, now) < (owner === "own" ? OWN_TTL_MS : OTHER_TTL_MS);
    if (!visible2) continue;
    const skewed = last - now > FUTURE_SKEW_MS2;
    const job = liveJobs.find((j) => jobHome.get(j) === key);
    const live = owner === "own" && !done && !stopped;
    const idle = live && age(last, now) >= LEFT_OPEN_MS;
    const title = i.titles?.[key];
    const slot = slotTasks.has(st.task) && st.project === execProject && !done && !stopped;
    built.push({
      row: {
        key,
        kind: "forge",
        owner,
        dim: owner === "other" || done || stopped,
        done,
        slot,
        expanded: false,
        stopped,
        task: st.task,
        project: st.project,
        title: title ? clip(title) : null,
        path: st.path || null,
        stage: done || stopped ? null : stageOf(st.phase || "triage"),
        round: st.reviews?.n ?? st.round,
        cap: st.reviews?.max ?? st.cap,
        verdict: st.verdict ? { action: st.verdict.action, score: st.verdict.score, round: st.verdict.round, findings: st.verdict.findings } : null,
        ...st.autonomy === "auto" ? { autonomy: "auto" } : {},
        ...idle ? { idle: true } : {},
        job: job ? { name: job.cmd, seconds: span2(ms(job.startedAt), now, now) } : null,
        seconds: skewed ? null : span2(ms(st.taskStartedAt), done || stopped ? ended : now, now),
        agents: live ? mine.map((l) => agentOf(l, i.links, i.models, now)) : []
      },
      at: orderAt(last, now),
      end,
      st,
      rank: done || stopped ? 2 : owner === "own" ? 0 : 1
    });
  }
  const runs = /* @__PURE__ */ new Map();
  for (const l of i.links) if (l.workflow) runs.set(l.workflow.runId, [...runs.get(l.workflow.runId) ?? [], l]);
  for (const [runId, ls] of runs) {
    const living = ls.filter(alive);
    const end = Math.max(...ls.map((l) => l.endedAt ?? -Infinity));
    if (!living.length && !(Number.isFinite(end) && age(end, now) < DONE_TTL_MS)) continue;
    const start = Math.min(...ls.map((l) => l.since));
    built.push({
      row: {
        ...summary(`wf:${isSafeId(runId) ? runId : "run"}`, "workflow", { title: ls[0].description ? clip(ls[0].description) : null, done: !living.length, dim: !living.length }),
        seconds: span2(start, living.length ? now : end, now),
        agents: living.map((l) => agentOf(l, i.links, i.models, now))
      },
      at: living.length ? now : end,
      end,
      st: null,
      rank: living.length ? 0 : 2
    });
  }
  built.sort((a, b) => a.rank - b.rank || (a.rank === 2 ? orderAt(b.end, now) - orderAt(a.end, now) : b.at - a.at));
  const forge = built.filter((b) => b.row.kind === "forge" && !b.row.slot);
  const focus = i.focusAgent ? i.links.find((l) => l.id === i.focusAgent) : void 0;
  const pick2 = (focus ? forge.find((b) => b.row.key === homes.get(focus.id)) : void 0) ?? forge.find((b) => b.rank === 0 && b.row.owner === "own") ?? forge.reduce((best, b) => !best || b.at > best.at ? b : best, void 0);
  if (pick2) pick2.row.expanded = true;
  if (pick2 && focus && pick2.row.key === homes.get(focus.id)) built.unshift(...built.splice(built.indexOf(pick2), 1));
  const out = built.map((b) => b.row);
  if (i.superpowers) {
    const s = i.superpowers;
    out.push(summary("sp", "superpowers", { title: s.plan || null, stage: s.current ? "fix" : null, round: s.current?.round ?? null, cap: s.current?.cap ?? null, done: s.tasks > 0 && s.done >= s.tasks, dim: !!s.stale }));
  }
  if (i.todos && i.todos.total > i.todos.done) out.push(summary("todo", "todo", { title: i.todos.inProgress, done: false, dim: false }));
  const adhoc = i.links.filter((l) => alive(l) && !l.task && !l.workflow);
  if (adhoc.length) out.push({ ...summary("adhoc", "adhoc", { title: null, done: false, dim: false }), agents: adhoc.map((l) => agentOf(l, i.links, i.models, now)) });
  const mainAgents = i.links.filter((l) => alive(l) && l.parentId === null);
  let waiting = null;
  if (i.turnSince === null && mainAgents.length) {
    const wakes = [i.viewer.coordinator ? ms(i.sleepUntil) : NaN, i.wakeAt ?? NaN].filter((t) => Number.isFinite(t) && t >= now);
    waiting = { agents: mainAgents.length, wakeSeconds: wakes.length ? Math.round((Math.min(...wakes) - now) / 1e3) : null };
  }
  const onRows = new Set(out.filter((a) => a.kind === "forge" && !a.slot && a.job).map((a) => a.key));
  const ownJob = (j) => !known || j.session === null || (i.sessionId ? j.session === i.sessionId : j.task !== null && i.ownTasks.some((t) => isOf(t, j.task) || isOf(j.task, t)));
  const jobs = liveJobs.filter((j) => !onRows.has(jobHome.get(j) ?? "") && ownJob(j)).sort((a, b) => ms(b.startedAt) - ms(a.startedAt)).slice(0, JOBS_SHOWN).map((j) => ({ name: j.cmd, task: j.task, seconds: span2(ms(j.startedAt), now, now) }));
  return { activities: out, waiting, jobs, expanded: pick2?.st ?? null };
}

// src/lens/model.ts
var CLIP3 = 80;
var MAX_RANGE = 1e3;
var clip2 = (s) => s.length > CLIP3 ? s.slice(0, CLIP3) : s;
var PROGRESS_LINE = /^\s*(?:[-*]\s*)?Tasks?\s+(\d+)(?:\s*[-–]\s*(\d+))?\s*:\s*(.*)$/i;
function parseSddLedger(text2) {
  const out = { planPath: null, done: [], current: null, lastLines: [] };
  if (typeof text2 !== "string") return out;
  try {
    const lines = text2.split(/\r?\n/);
    const head = /^#\s+SDD ledger\b.*?\bplan:\s*(.+?)\s*$/i.exec(lines[0] ?? "");
    if (head) out.planPath = head[1];
    const start = lines.findIndex((l) => /^##\s+Progress\s*$/i.test(l));
    let section = lines;
    if (start >= 0) {
      let end = lines.length;
      for (let i = start + 1; i < lines.length; i++) if (/^##\s/.test(lines[i])) {
        end = i;
        break;
      }
      section = lines.slice(start + 1, end);
    }
    const done = /* @__PURE__ */ new Set();
    const fixes = [];
    for (const line of section) {
      const m = PROGRESS_LINE.exec(line);
      if (!m) continue;
      let lo = Number(m[1]);
      let hi = m[2] !== void 0 ? Number(m[2]) : lo;
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue;
      if (hi < lo) [lo, hi] = [hi, lo];
      if (hi - lo >= MAX_RANGE) hi = lo + MAX_RANGE - 1;
      const rest = m[3];
      if (/^complete\b/i.test(rest)) {
        for (let n2 = lo; n2 <= hi; n2++) done.add(n2);
        continue;
      }
      const fix = /^fix round\s+(\d+)(?:\s*\/\s*(\d+))?/i.exec(rest);
      if (fix) fixes.push({ lo, hi, label: m[2] !== void 0 ? `${m[1]}-${m[2]}` : m[1], round: Number(fix[1]), cap: fix[2] !== void 0 ? Number(fix[2]) : null });
    }
    out.done = [...done].sort((a, b) => a - b);
    for (let i = fixes.length - 1; i >= 0; i--) {
      const f = fixes[i];
      let open = false;
      for (let n2 = f.lo; n2 <= f.hi; n2++) if (!done.has(n2)) {
        open = true;
        break;
      }
      if (open) {
        out.current = { task: f.label, round: f.round, cap: f.cap };
        break;
      }
    }
    out.lastLines = section.map((l) => l.trimEnd()).filter((l) => l.trim() !== "").slice(-3).map(clip2);
  } catch {
  }
  return out;
}
function parsePlanTasks(md) {
  const tasks = [];
  if (typeof md !== "string") return tasks;
  let cur = null;
  for (const line of md.split(/\r?\n/)) {
    const heading = /^###\s+Task\s+(\d+)\s*:\s*(.*?)\s*$/.exec(line);
    if (heading) {
      cur = { n: Number(heading[1]), title: heading[2], steps: 0, checked: 0 };
      tasks.push(cur);
      continue;
    }
    if (!cur) continue;
    const c2 = /^\s*[-*]\s+\[([ xX])\]/.exec(line);
    if (c2) {
      cur.steps++;
      if (c2[1] !== " ") cur.checked++;
    }
  }
  return tasks;
}
var TODO_ACTIVE_MAX = 3;
var TODO_CELLS_MAX = 200;
function summarizeTodos(todos) {
  const out = { total: 0, done: 0, inProgress: null, next: [], active: [], cells: "" };
  if (!Array.isArray(todos)) return out;
  for (const raw of todos) {
    if (!raw || typeof raw !== "object") continue;
    const t = raw;
    if (typeof t.content !== "string") continue;
    out.total++;
    let cell = "p";
    if (t.status === "completed") {
      out.done++;
      cell = "d";
    } else if (t.status === "in_progress") {
      const text2 = clip2(typeof t.activeForm === "string" && t.activeForm ? t.activeForm : t.content);
      if (out.inProgress === null) out.inProgress = text2;
      if (out.active.length < TODO_ACTIVE_MAX) out.active.push(text2);
      cell = "a";
    } else if (out.next.length < 3) out.next.push(clip2(t.content));
    if (out.cells.length < TODO_CELLS_MAX) out.cells += cell;
  }
  return out;
}
var secs = (now, since) => Number.isFinite(now) && Number.isFinite(since) ? Math.max(0, Math.floor((now - since) / 1e3)) : null;
function usageTime(session, run, turnSince, now) {
  const live = turnSince !== null && Number.isFinite(turnSince) && Number.isFinite(now) && now > turnSince ? now - turnSince : 0;
  const active = (s) => Math.floor((s.activeMs + live) / 1e3);
  const since = (s) => s.startedAt > 0 && Number.isFinite(now) && now >= s.startedAt ? Math.floor((now - s.startedAt) / 1e3) : null;
  const shown = run ?? session;
  return {
    activeSeconds: active(shown),
    activePartial: !!run?.activePartial,
    sinceStartSeconds: since(shown),
    session: run ? { activeSeconds: active(session), sinceStartSeconds: since(session) } : null
  };
}
var STALE_LEDGER_MS = 24 * 36e5;
function superpowers(input) {
  try {
    if (input.ledger !== void 0) {
      const l = parseSddLedger(input.ledger);
      const plan = input.ledgerPlan !== void 0 ? parsePlanTasks(input.ledgerPlan) : [];
      let tasks;
      let done;
      if (plan.length) {
        const nums = new Set(plan.map((p) => p.n));
        tasks = plan.length;
        done = l.done.filter((n2) => nums.has(n2)).length;
      } else {
        tasks = Math.max(0, ...l.done, ...l.current ? [parseInt(l.current.task.split("-").pop() ?? "0", 10) || 0] : []);
        done = l.done.length;
      }
      const stale = input.ledgerMtimeMs !== void 0 && input.now - input.ledgerMtimeMs > STALE_LEDGER_MS;
      if (stale && !l.current && done === tasks) return null;
      return { plan: clip2(l.planPath ?? ""), tasks, done, current: l.current, lastLines: l.lastLines, ...stale ? { stale: true } : {} };
    }
    if (input.planFallback !== void 0) {
      const plan = parsePlanTasks(input.planFallback);
      if (!plan.some((p) => p.checked > 0)) return null;
      const title = /^#\s+(.+?)\s*$/m.exec(input.planFallback)?.[1] ?? "";
      return {
        plan: clip2(title),
        tasks: plan.length,
        done: plan.filter((p) => p.steps > 0 && p.checked === p.steps).length,
        current: null,
        lastLines: []
      };
    }
  } catch {
  }
  return null;
}
var FORGE_WINDOW_MS = 24 * 36e5;
var MAX_PROPOSALS = 5;
var PROPOSAL_ID = /^p\d{14}[0-9a-z]{4}$/;
function forgeOf(st, now, briefs = null, liveTypes = []) {
  const { ts: _ts, taskStartedAt: _a, stageSince: _b, stages: _c, doneAt: _d, lastAt: _e, session: _s, runId: _r, project: _p, ...forge } = st;
  const working = !!st.agent && liveTypes.some((t) => tierOf(t).label === tierOf(st.agent).label);
  const left = !working && leftOpen(st, now);
  const skewed = Date.parse(st.lastAt ?? st.ts) - now > FUTURE_SKEW_MS2;
  const timing = skewed ? null : forgeTiming(left ? { ...st, doneAt: st.lastAt } : st, now);
  return { ...forge, ...left ? { agent: null } : {}, briefs, timing };
}
var FORGE_STATUSES_READ = 20;
var FORGE_STATUS_TEXT_MAX = 64 * 1024;
function parseStatuses(texts) {
  const out = [];
  for (const text2 of texts.slice(0, FORGE_STATUSES_READ)) {
    if (typeof text2 !== "string" || text2.length > FORGE_STATUS_TEXT_MAX) continue;
    try {
      const st = normalizeStatus(JSON.parse(text2));
      if (st) out.push(st);
    } catch {
    }
  }
  return out;
}
function newestForge(statuses, now, briefsOf, liveTypes) {
  const st = [...statuses].sort((x, y) => (Date.parse(y.lastAt ?? y.ts) || 0) - (Date.parse(x.lastAt ?? x.ts) || 0))[0];
  const t = st ? Date.parse(st.ts) : NaN;
  return st && Number.isFinite(t) && now - t <= FORGE_WINDOW_MS ? forgeOf(st, now, briefsOf(st), liveTypes) : null;
}
function elapsed(from, to, now) {
  const t = from ? Date.parse(from) : NaN;
  if (!Number.isFinite(t) || !Number.isFinite(to) || !Number.isFinite(now)) return null;
  if (t - now > FUTURE_SKEW_MS2 || to - now > FUTURE_SKEW_MS2 || to < t) return null;
  return Math.floor((to - t) / 1e3);
}
function forgeTiming(st, now) {
  if (!st.taskStartedAt) return null;
  const rawDone = st.doneAt ? Date.parse(st.doneAt) : NaN;
  const doneMs = elapsed(st.taskStartedAt, rawDone, now) !== null ? rawDone : NaN;
  const done = Number.isFinite(doneMs);
  const sums = /* @__PURE__ */ new Map();
  for (const [phase, s] of Object.entries(st.stages ?? {})) {
    if (typeof s !== "number" || !Number.isFinite(s) || s < 0) continue;
    const name = stageOf(phase);
    sums.set(name, (sums.get(name) ?? 0) + s);
  }
  const current = stageOf(st.phase || "triage");
  const liveSecs = done ? null : elapsed(st.stageSince, now, now);
  if (liveSecs !== null) sums.set(current, (sums.get(current) ?? 0) + liveSecs);
  const tail = done ? elapsed(st.stageSince, doneMs, now) : null;
  if (tail) sums.set(current, (sums.get(current) ?? 0) + tail);
  const order = STAGES2;
  const known = order.filter((n2) => sums.has(n2));
  const other = [...sums.keys()].filter((n2) => !order.includes(n2));
  return {
    taskSeconds: elapsed(st.taskStartedAt, done ? doneMs : now, now),
    done,
    stages: [...known, ...other].map((name) => ({ name, seconds: sums.get(name), live: liveSecs !== null && name === current }))
  };
}
function pendingProposals2(texts) {
  const out = [];
  if (!texts || typeof texts !== "object") return out;
  for (const id2 of Object.keys(texts).filter((k) => PROPOSAL_ID.test(k)).sort().reverse()) {
    let doc;
    try {
      doc = normalizeProposal(JSON.parse(texts[id2]));
    } catch {
      continue;
    }
    if (!doc || doc.status !== "proposed" && doc.status !== "discussing") continue;
    out.push({ id: id2, title: cleanText(doc.title), category: doc.category, risk: doc.risk });
    if (out.length >= MAX_PROPOSALS) break;
  }
  return out;
}
var FORGE_RUN_MAX = 16 * 1024;
var FORGE_EXEC_MAX = 64 * 1024;
var FORGE_EXEC_FILE_MAX = 8 * 1024;
var FORGE_EXEC_TASKS_MAX = 50;
var FORGE_LIVE_MAX = 20;
function statusRootOf(root, main) {
  const norm = (p) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const r = norm(root);
  const name = r.split("/").pop() ?? "";
  return name.startsWith("task-") && r.toLowerCase() === `${norm(main)}/.claude/worktrees/${name}`.toLowerCase() ? main : root;
}
function secondsSince(ts, now) {
  const since = Date.parse(ts);
  return Number.isFinite(since) && Number.isFinite(now) ? Math.max(0, Math.round((now - since) / 1e3)) : 0;
}
function executionFromFiles(execText, taskTexts = {}, liveTexts = {}, now, titles, role) {
  if (typeof execText !== "string" || execText.length > FORGE_EXEC_MAX) return null;
  const tasks = {};
  for (const [id2, t] of Object.entries(taskTexts)) {
    if (typeof t !== "string" || t.length > FORGE_EXEC_FILE_MAX) continue;
    try {
      const p = normalizePublicTask(JSON.parse(t));
      if (p && p.task === id2) tasks[id2] = p;
    } catch {
    }
  }
  const live = [];
  for (const t of Object.values(liveTexts)) {
    if (typeof t !== "string" || t.length > FORGE_EXEC_FILE_MAX) continue;
    try {
      const d = normalizeLive(JSON.parse(t));
      if (d) live.push(d);
    } catch {
    }
  }
  let v;
  let exec;
  const clean2 = titles && Object.fromEntries(Object.entries(titles).map(([id2, t]) => [id2, cleanText(t)]));
  try {
    exec = parseExecution(execText, now);
    v = executionView({ exec, tasks, live, titles: clean2, now, role });
  } catch {
    return null;
  }
  if (!v) return null;
  const to = v.frozenAt ? Math.min(now, Date.parse(v.frozenAt)) : now;
  return {
    runId: v.runId,
    project: exec?.kind === "plan" && isSafeId(exec.project) ? exec.project : null,
    mode: v.mode,
    parallel: v.parallel,
    branch: v.branch,
    active: v.active,
    stopReason: v.stopReason,
    stallReason: v.stallReason ? clip2(v.stallReason) : null,
    coordinator: { ...v.coordinator },
    integrated: v.integrated,
    total: v.total,
    elapsedSeconds: elapsed(v.startedAt, to, now),
    finished: v.finished.map((f) => ({ task: f.task, seconds: elapsed(f.startedAt, Date.parse(f.finishedAt), now) })).filter((f) => f.seconds !== null),
    // model / effort: lens knows them only for its own session's subagents (from the usage loops), not for these.
    slots: v.slots.map((s) => ({
      task: s.task,
      title: s.title ? clip2(s.title) : null,
      stage: s.stage,
      agent: s.agent,
      model: null,
      effort: null,
      round: s.round,
      seconds: secondsSince(s.since, to),
      taskSeconds: elapsed(s.startedAt, to, now),
      liveness: s.liveness,
      mode: s.mode
    })),
    manual: v.manual.map((s) => ({
      task: s.task,
      title: s.title ? clip2(s.title) : null,
      stage: s.stage,
      seconds: secondsSince(s.since, to),
      liveness: s.liveness,
      by: s.by ?? ""
    })),
    queued: v.queued,
    conflicts: v.conflicts,
    blocked: v.blocked,
    orphans: v.orphans,
    sleepUntil: v.sleepUntil,
    // C2: someone else's run (another live session's, or one left behind) is drawn dim; with no role known, it is not.
    dim: role === "other-live" || role === "previous"
  };
}
var MAX_AUTO = 3;
function autoApproved(texts) {
  const out = [];
  if (!texts || typeof texts !== "object") return out;
  for (const id2 of Object.keys(texts).filter((k) => PROPOSAL_ID.test(k)).sort().reverse()) {
    let doc;
    try {
      doc = normalizeProposal(JSON.parse(texts[id2]));
    } catch {
      continue;
    }
    if (!doc || doc.status !== "auto_approved") continue;
    out.push(cleanText(doc.title));
    if (out.length >= MAX_AUTO) break;
  }
  return out;
}
function infiniteFromRun(text2, proposals, now) {
  if (typeof text2 !== "string" || text2.length > FORGE_RUN_MAX) return null;
  const run = parseRun(text2);
  if (!run) return null;
  let hoursLeft = null;
  const started = Date.parse(run.startedAt);
  if (run.budget.hours !== void 0 && Number.isFinite(now) && Number.isFinite(started)) {
    hoursLeft = Math.max(0, Math.round((run.budget.hours - (now - started) / 36e5) * 10) / 10);
  }
  const max = run.budget.cycles ?? null;
  const cycle = run.active ? Math.min(run.cycle + 1, max ?? Infinity) : run.cycle;
  return { cycle, cyclesMax: max, hoursLeft, active: run.active, autoApproved: autoApproved(proposals) };
}
function bandKey(model) {
  const { subagentsDone: _done, usage: usage2, forge, subagents, tool, turnSeconds: _turn, activities, jobs, waiting, ...rest } = model;
  const key = { ...rest };
  key.subagents = subagents.map(({ seconds: _s, ...s }) => s);
  key.tool = tool ? { name: tool.name } : null;
  key.activities = activities.map(({ seconds: _s, job, agents, ...a }) => ({
    ...a,
    job: job ? { name: job.name } : null,
    agents: agents.map(({ seconds: _x, tool: _y, ...g }) => g)
  }));
  key.jobs = jobs.map(({ seconds: _s, ...j }) => j);
  key.waiting = waiting ? { agents: waiting.agents } : null;
  if (usage2) {
    const { time: _time, ...u } = usage2;
    key.usage = u;
  } else key.usage = usage2;
  if (forge) {
    const { timing, ...f } = forge;
    key.forge = { ...f, done: timing?.done ?? null };
  } else key.forge = forge;
  if (rest.execution) {
    const { elapsedSeconds: _e, finished: _f, slots, manual, ...x } = rest.execution;
    key.execution = {
      ...x,
      slots: slots.map(({ taskSeconds: _t, seconds: _s, agents, ...s }) => ({ ...s, agents: (agents ?? []).map(({ seconds: _a, tool: _b, ...g }) => g) })),
      manual: manual.map(({ seconds: _m, ...m }) => m)
    };
  }
  return JSON.stringify(key);
}
function buildPanelModel(input) {
  const { band, activity: a, now } = input;
  const wp = band.mode === "work" ? band : null;
  const rb = band.mode === "run" ? band : null;
  const cc = a.ccTasks ?? [];
  const todos = summarizeTodos(a.todos);
  const sess = input.usage?.session ?? null;
  const mainLoop = sess?.loops[MAIN];
  const loopOfAgent = (id2) => sess?.loops[id2];
  const hasSteps = !!sess && Object.values(sess.loops).some((l) => l.steps > 0);
  let usage2 = null;
  if (input.usage && hasSteps) {
    const own = summarizeUsage(input.usage.session);
    const shown2 = input.usage.run ? summarizeUsage(input.usage.run) : own;
    const official = input.usage.officialUsd;
    const at = input.usage.officialOwnUsd ?? null;
    const drift = !own.partial && official !== null && official > 0 && at !== null && Math.abs(at - official) > official * 0.1;
    usage2 = {
      scope: input.usage.run ? "run" : "session",
      tokens: shown2.tokens,
      costUsd: shown2.costUsd,
      partial: shown2.partial,
      sessionPartial: own.partial,
      officialUsd: official,
      drift,
      session: input.usage.run ? { tokens: own.tokens, costUsd: own.costUsd } : null,
      groups: shown2.groups,
      tracking: shown2.tracking,
      withoutForge: shown2.withoutForge,
      time: usageTime(input.usage.session, input.usage.run, a.turnSince ?? null, now),
      pricesAsOf: PRICES_AS_OF
    };
  }
  const viewer = band.viewer ?? { role: "none", coordinator: false, runId: null };
  const execution = executionFromFiles(
    input.forgeExecution,
    input.forgeExecTasks,
    input.forgeLive,
    now,
    wp?.current ? { [wp.current.id]: wp.current.title } : void 0,
    runRoleOf(band)
  );
  const titles = {};
  const titleOf = (task, project, title) => {
    const k = statusKey(task, project);
    if (k) titles[k] = title;
  };
  for (const s of execution?.slots ?? []) if (s.title) titleOf(s.task, execution?.project ?? null, s.title);
  if (wp?.current) {
    titleOf(wp.current.id, wp.project, wp.current.title);
    if (!titles[wp.current.id]) titleOf(wp.current.id, null, wp.current.title);
  }
  const sp = superpowers(input);
  const todosModel = todos.total ? todos : null;
  const statuses = parseStatuses(input.forgeStatuses ?? (input.forgeStatus !== void 0 ? [input.forgeStatus] : []));
  const links2 = input.links ?? [];
  const liveTypes = (a.subagents ?? []).map((s) => s.type);
  const models = Object.fromEntries(Object.entries(sess?.loops ?? {}).map(([id2, l]) => [id2, { ...l.model ? { model: l.model } : {}, ...l.effort ? { effort: l.effort } : {} }]));
  let view = { activities: [], waiting: null, jobs: [], expanded: null };
  let failed = false;
  let homes;
  try {
    homes = linkHomes({ statuses, links: links2, sessionId: input.sessionId, ownTasks: input.ownTasks ?? [], now });
    view = buildActivities({
      statuses,
      links: links2,
      execution,
      superpowers: sp,
      todos: todosModel,
      titles,
      sessionId: input.sessionId,
      ownTasks: input.ownTasks ?? [],
      viewer,
      jobs: (input.forgeJobs ?? []).map(parseJob).filter((j) => j !== null),
      models,
      liveTypes,
      turnSince: a.turnSince ?? null,
      wakeAt: input.wakeAt ?? null,
      sleepUntil: execution?.sleepUntil ?? null,
      focusAgent: input.focusAgent ?? null,
      now,
      homes
    });
  } catch {
    failed = true;
  }
  const briefsOf = (st) => input.forgeBriefsBy?.[statusKey(st.task, st.project) ?? st.task] ?? (input.forgeStatuses === void 0 ? input.forgeBriefs ?? null : null);
  const forge = failed ? newestForge(statuses, now, briefsOf, liveTypes) : view.expanded ? forgeOf(view.expanded, now, briefsOf(view.expanded), liveTypes) : null;
  const underRows = new Set(view.activities.filter((x) => x.kind === "forge" && !x.slot).flatMap((x) => x.agents.map((g) => g.id)));
  const withAgents = withSlotAgents(execution, links2, models, viewer, now, homes, underRows);
  const shown = new Set(view.activities.filter((x) => !x.slot && x.kind !== "adhoc").flatMap((x) => x.agents.map((g) => g.id)));
  for (const s of withAgents?.slots ?? []) for (const g of s.agents ?? []) shown.add(g.id);
  const taskOf = new Map(links2.flatMap((l) => l.task ? [[l.id, l.task]] : []));
  return {
    locale: wp?.locale ?? rb?.locale ?? input.locale ?? "en",
    waypoint: wp ? {
      project: wp.project,
      track: wp.track,
      percent: wp.percent,
      trackDone: wp.trackDone,
      trackTotal: wp.trackTotal,
      current: wp.current,
      inbox: wp.inbox,
      escalation: wp.escalation,
      roadmapUrl: wp.roadmapUrl,
      locale: wp.locale,
      phase: wp.phase ? { ...wp.phase, name: clip2(wp.phase.name) } : null,
      cells: typeof wp.cells === "string" ? wp.cells.replace(/[^dabp]/g, "").slice(0, 120) : "",
      recentDone: (wp.recentDone ?? []).slice(0, 3)
    } : rb ? {
      // E-10: the band of an execution: its progress, the seat's messages and decision and the phase, without a task.
      project: rb.project,
      track: null,
      percent: rb.percent,
      trackDone: rb.integrated,
      trackTotal: rb.total,
      current: null,
      inbox: rb.inbox,
      escalation: rb.escalation,
      roadmapUrl: rb.roadmapUrl,
      locale: rb.locale,
      phase: rb.phase ? { ...rb.phase, name: clip2(rb.phase.name) } : null,
      cells: "",
      recentDone: [],
      run: true
    } : null,
    superpowers: sp,
    todos: todosModel,
    subagents: (a.subagents ?? []).map((s) => {
      const loop = loopOfAgent(s.id);
      const task = taskOf.get(s.id);
      return {
        id: s.id,
        type: s.type,
        ...s.description !== void 0 ? { description: clip2(s.description) } : {},
        ...s.status !== void 0 ? { status: s.status } : {},
        seconds: secs(now, s.since),
        ...loop?.model ? { model: loop.model } : {},
        ...loop?.effort ? { effort: loop.effort } : {},
        ...task ? { task } : {},
        ...shown.has(s.id) ? { shown: true } : {}
      };
    }),
    subagentsDone: freshFinished(a.finished ?? [], now).map((f) => ({
      id: f.id,
      type: f.type,
      ...f.description ? { description: clip2(f.description) } : {},
      ...f.model ? { model: f.model } : {},
      seconds: f.seconds
    })),
    tool: a.tool ? { name: a.tool.name, seconds: secs(now, a.tool.since) } : null,
    turnSeconds: a.turnSince === null || a.turnSince === void 0 ? null : secs(now, a.turnSince),
    ccTasks: cc.length ? { open: cc.filter((t) => !t.done).length, done: cc.filter((t) => t.done).length, recent: cc.slice(-3).map((t) => clip2(t.subject)) } : null,
    forge,
    infinite: infiniteFromRun(input.forgeRun, input.proposals, now),
    decisions: decisionsSummary(input.forgeDecisions, now),
    execution: withAgents,
    proposals: pendingProposals2(input.proposals),
    mainModel: mainLoop?.model ? { model: mainLoop.model, effort: mainLoop.effort } : null,
    activities: view.activities,
    waiting: view.waiting,
    jobs: view.jobs,
    usage: usage2
  };
}

// src/lib/main-checkout.ts
function mainCheckoutFrom(root, gitFileText) {
  const m = gitFileText ? /^gitdir:\s*(.+?)[\\/]\.git[\\/]worktrees[\\/][^\\/\r\n]+\s*$/m.exec(gitFileText) : null;
  const dir = m ? m[1] : null;
  return dir && (/^[A-Za-z]:/.test(dir) || dir.startsWith("/")) ? dir : root;
}

// src/lib/text-width.ts
var ZERO = /[\p{Mn}\p{Me}\p{Cf}]/u;
var WIDE = [
  [4352, 4447],
  [8986, 8987],
  [9193, 9196],
  [9200, 9200],
  [9203, 9203],
  [9725, 9726],
  [9748, 9749],
  [9800, 9811],
  [9855, 9855],
  [9875, 9875],
  [9889, 9889],
  [9898, 9899],
  [9917, 9918],
  [9924, 9925],
  [9934, 9934],
  [9940, 9940],
  [9962, 9962],
  [9970, 9971],
  [9973, 9973],
  [9978, 9978],
  [9981, 9981],
  [9989, 9989],
  [9994, 9995],
  [10024, 10024],
  [10060, 10060],
  [10062, 10062],
  [10067, 10069],
  [10071, 10071],
  [10133, 10135],
  [10160, 10160],
  [10175, 10175],
  [11035, 11036],
  [11088, 11088],
  [11093, 11093],
  [11904, 12350],
  [12353, 13311],
  [13312, 19903],
  [19968, 40959],
  [40960, 42191],
  [44032, 55203],
  [63744, 64255],
  [65072, 65103],
  [65280, 65376],
  [65504, 65510],
  [126980, 126980],
  [127183, 127183],
  [127374, 127374],
  [127377, 127386],
  [127462, 127487],
  [127488, 127743],
  [127744, 129791],
  [131072, 262141]
];
var VS16 = 65039;
var ZWJ = 8205;
function within(cp3, ranges) {
  for (const [lo, hi] of ranges) {
    if (cp3 < lo) return false;
    if (cp3 <= hi) return true;
  }
  return false;
}
function charWidth(cp3) {
  if (cp3 < 127) return cp3 < 32 ? 0 : 1;
  if (cp3 < 160) return 0;
  if (ZERO.test(String.fromCodePoint(cp3))) return 0;
  return within(cp3, WIDE) ? 2 : 1;
}
var isRegional = (cp3) => cp3 >= 127462 && cp3 <= 127487;
var isTone = (cp3) => cp3 >= 127995 && cp3 <= 127999;
function splitClusters(text2) {
  const out = [];
  let joined = false;
  let regionals = 0;
  for (const ch of String(text2)) {
    const cp3 = ch.codePointAt(0) ?? 0;
    const sticks = out.length > 0 && (joined && /\p{Extended_Pictographic}/u.test(ch) || cp3 === ZWJ || isTone(cp3) || cp3 >= 65024 && cp3 <= 65039 || cp3 >= 917536 && cp3 <= 917631 || cp3 >= 160 && /[\p{Mn}\p{Me}]/u.test(ch) || isRegional(cp3) && regionals === 1);
    if (sticks) out[out.length - 1] += ch;
    else {
      out.push(ch);
      regionals = 0;
    }
    if (isRegional(cp3)) regionals += 1;
    joined = cp3 === ZWJ;
  }
  return out;
}
var segmenter = typeof Intl !== "undefined" && typeof Intl.Segmenter === "function" ? new Intl.Segmenter(void 0, { granularity: "grapheme" }) : null;
function clustersOf(text2) {
  const s = String(text2);
  return segmenter ? Array.from(segmenter.segment(s), (part) => part.segment) : splitClusters(s);
}
function clusterWidth(cluster) {
  let widest = 0;
  for (const ch of cluster) {
    const cp3 = ch.codePointAt(0) ?? 0;
    if (cp3 === VS16) {
      if (widest > 0) return 2;
      continue;
    }
    widest = Math.max(widest, charWidth(cp3));
  }
  return widest;
}
function stringWidth(text2) {
  let width = 0;
  for (const cluster of clustersOf(text2)) width += clusterWidth(cluster);
  return width;
}
function clipWidth(text2, max) {
  const s = String(text2);
  if (stringWidth(s) <= max) return s;
  if (!(max >= 1)) return "";
  let out = "";
  let used = 0;
  for (const cluster of clustersOf(s)) {
    const cells2 = clusterWidth(cluster);
    if (used + cells2 > max - 1) break;
    out += cluster;
    used += cells2;
  }
  return `${out}\u2026`;
}

// src/mod/band-fit.ts
var SEP = " \xB7 ";
var TITLE_MIN = 8;
var DEFAULT_COLUMNS = 80;
var SLOT = "slot:";
var visible = (parts) => parts.filter((p) => stringWidth(p.text) > 0);
function partsWidth(parts, sep = SEP) {
  let width = 0;
  visible(parts).forEach((p, i) => {
    width += stringWidth(p.text) + (i ? stringWidth(p.glue ?? sep) : 0);
  });
  return width;
}
function joinParts(parts, sep = SEP) {
  return visible(parts).map((p, i) => `${i ? p.glue ?? sep : ""}${p.text}`).join("");
}
var columnsOf = (cols) => typeof cols === "number" && Number.isFinite(cols) ? Math.max(0, Math.floor(cols)) : 0;
var prioKey = (p) => Number.isNaN(p.prio) ? Number.POSITIVE_INFINITY : p.prio;
function fitParts(parts, cols, sep = SEP) {
  const width = columnsOf(cols);
  const cur = parts.map((p) => ({ ...p }));
  const gone = /* @__PURE__ */ new Set();
  const view = () => {
    const out = [];
    let more = 0;
    let at = -1;
    let after = false;
    cur.forEach((p, i) => {
      if (!gone.has(i)) {
        out.push(after ? { ...p, glue: void 0 } : p);
        after = false;
        return;
      }
      after = true;
      if (p.key.startsWith(SLOT)) {
        more += Number.isInteger(p.count) && p.count > 0 ? p.count : 1;
        if (at < 0) at = out.length;
      }
    });
    if (more) out.splice(at, 0, { key: "more", text: `+${more}`, prio: 4 });
    return out;
  };
  const fits = () => partsWidth(view(), sep) <= width;
  const done = () => ({ shown: view(), dropped: gone.size });
  if (fits()) return done();
  const order = cur.map((_, i) => i).sort((a, b) => {
    const ka = prioKey(cur[a]);
    const kb = prioKey(cur[b]);
    return ka === kb ? b - a : kb > ka ? 1 : -1;
  });
  for (const i of order) {
    const p = cur[i];
    if (p.title && p.text.endsWith(p.title)) {
      const lead = p.text.slice(0, p.text.length - p.title.length);
      for (let w = stringWidth(p.title) - 1; w >= TITLE_MIN; w--) {
        cur[i] = { ...p, text: lead + clipWidth(p.title, w) };
        if (fits()) return done();
      }
    }
    if (p.short !== void 0 && stringWidth(p.short) < stringWidth(cur[i].text)) {
      cur[i] = { ...cur[i], text: p.short };
      if (fits()) return done();
    }
  }
  for (const i of order) {
    gone.add(i);
    if (fits()) return done();
  }
  return { shown: [], dropped: gone.size };
}
var WIDE_COLUMNS = 140;
var TWO_COLUMNS = 90;
var ONE_ROW_BELOW = 3;
function bandLevel(o) {
  if (!o.fullscreen || o.maxRows < ONE_ROW_BELOW || o.bodyColumns < TWO_COLUMNS) return "one";
  return o.bodyColumns >= WIDE_COLUMNS ? "wide" : "two";
}
function controlWidth(label, o) {
  const w = stringWidth(label);
  if (o.kind === "link" || o.kind === "text") return w;
  return o.plain ? w + (o.hotkey ? 3 : 0) : w + 4;
}

// src/mod/band-line.ts
var TITLE_MAX = 40;
var BIDI = new RegExp(`[${[1564, 8206, 8207, 8234, 8235, 8236, 8237, 8238, 8294, 8295, 8296, 8297].map((c2) => String.fromCharCode(c2)).join("")}]`, "g");
var CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
function clip3(text2, max = TITLE_MAX) {
  return clipWidth(String(text2).replace(CONTROL, " ").replace(BIDI, "").replace(/\s+/g, " ").trim(), max);
}
var STAGE_SHORT = {
  triage: "tri",
  brief: "brief",
  implement: "impl",
  validate: "val",
  verify: "ver",
  review: "rev",
  verdict: "verd",
  integrate: "int",
  execution: "exec"
};

// src/mod/files.ts
var MAX_DOCS = CACHE_DOCS_MAX;
var join = (...parts) => parts.join("/");
async function readOpt($, path) {
  try {
    return await $.fs.read(path);
  } catch {
    return void 0;
  }
}
async function listOpt($, path) {
  try {
    return await $.fs.list(path);
  } catch {
    return [];
  }
}
async function mtime($, path) {
  try {
    return (await $.fs.stat(path)).mtimeMs;
  } catch {
    return null;
  }
}
async function nowMs($) {
  try {
    const n2 = await $.clock.now();
    if (Number.isFinite(n2)) return n2;
  } catch {
  }
  return Date.now();
}
async function readCollection($, dir, keep) {
  const out = {};
  const sorted = (await listOpt($, dir)).filter((f) => f.kind === "file" && f.name.endsWith(".json")).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const files = keep === "first" ? sorted.slice(0, MAX_DOCS) : sorted.slice(-MAX_DOCS);
  for (const f of files) {
    const text2 = await readOpt($, join(dir, f.name));
    if (text2 !== void 0) out[f.name.slice(0, -5)] = text2;
  }
  return out;
}
async function sessionIdOf($) {
  try {
    const id2 = await $.session.id();
    return isSafeId(id2) ? id2 : null;
  } catch {
    return null;
  }
}
async function readSmall($, path, max) {
  try {
    const st = await $.fs.stat(path);
    if (typeof st.size === "number" && st.size > max) return void 0;
  } catch {
    return void 0;
  }
  return readOpt($, path);
}
async function readBoundText($, path, now) {
  const text2 = await readSmall($, path, BOUND_MAX_BYTES);
  if (text2 === void 0 || parseBound(text2, now) !== null) return text2;
  try {
    await $.clock.sleep(BOUND_REREAD_MS);
  } catch {
  }
  return readSmall($, path, BOUND_MAX_BYTES);
}
async function seatFiles($, wp, now) {
  const bindings = {};
  const seatSessions = {};
  const session = await readSmall($, join(wp, "session.json"), SESSION_MAX_BYTES);
  const own = await readBoundText($, join(wp, "bound.json"), now);
  if (own !== void 0) bindings["."] = own;
  const checkout = checkoutSidOf(session, own, now);
  const names = (await listOpt($, join(wp, "seats"))).filter((d) => d.kind === "dir" && isSafeId(d.name) && d.name !== checkout).map((d) => d.name).sort().slice(0, MAX_SEATS);
  for (const n2 of names) {
    const text2 = await readBoundText($, join(wp, "seats", n2, "bound.json"), now);
    if (text2 === void 0) continue;
    bindings[n2] = text2;
    const s = await readSmall($, join(wp, "seats", n2, "session.json"), SESSION_MAX_BYTES);
    if (s !== void 0) seatSessions[n2] = s;
  }
  return { session, bindings, seatSessions };
}
async function projectEntries($, root, now) {
  const docs = join(root, "docs", "waypoint");
  const dirs = (await listOpt($, docs)).filter((d) => d.kind === "dir");
  const out = [];
  for (const d of dirs) {
    const times = [await mtime($, join(docs, d.name, "plan.yaml")), await mtime($, join(docs, d.name, "design.md"))].filter((t) => t !== null);
    if (!times.length) continue;
    const seats = await seatFiles($, join(root, ".waypoint", d.name), now);
    const bindings = seatsOf(seats, now).flatMap((s) => s.bound ? [s.bound] : []);
    out.push({ entry: { name: d.name, bindings, mtimeMs: Math.max(...times) }, seats });
  }
  return out;
}
var EXEC_MAX = 64 * 1024;
var EXEC_FILE_MAX = FORGE_DOC_MAX_BYTES;
var EXEC_TASKS_MAX = 50;
var LIVE_MAX = 20;
var SAFE_TASK = /^(?!\.{1,2}$)[A-Za-z0-9._-]{1,80}$/;
async function readEach($, dir, files) {
  const out = {};
  for (const f of files) {
    const text2 = await readOpt($, join(dir, f.name));
    if (text2 !== void 0) out[f.name.slice(0, -5)] = text2;
  }
  return out;
}
async function readJsonDir($, dir, max, keep) {
  const files = (await listOpt($, dir)).filter((f) => f.kind === "file" && f.name.endsWith(".json") && f.size <= EXEC_FILE_MAX && keep(f.name.slice(0, -5))).sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, max);
  return readEach($, dir, files);
}
async function claudeBindingTexts($, main, claude, now) {
  const out = {};
  const projects = (await listOpt($, join(main, ".waypoint"))).filter((d) => d.kind === "dir").slice(0, MAX_PROJECTS);
  for (const p of projects) {
    const seats = await seatFiles($, join(main, ".waypoint", p.name), now);
    for (const s of seatsOf(seats, now)) {
      const key = s.checkout ? "." : s.sid;
      const text2 = seats.bindings?.[key];
      if (s.bound?.claude === claude && text2 !== void 0) out[`${p.name}/${key}`] = text2;
    }
  }
  return out;
}
async function loadForge($, root, now) {
  try {
    const main = mainCheckoutFrom(root, await readOpt($, join(root, ".git")) ?? null);
    const dir = join(main, ".forge");
    const entries = await listOpt($, dir);
    const out = {};
    const dec2 = entries.find((f) => f.kind === "file" && f.name === "decisions.json");
    if (dec2 && dec2.size <= DECISIONS_MAX) out.decisions = await readOpt($, join(dir, "decisions.json"));
    const exec = entries.find((f) => f.kind === "file" && f.name === "execution.json");
    if (!exec || exec.size > EXEC_MAX) return out;
    const execution = await readOpt($, join(dir, "execution.json"));
    if (execution === void 0) return out;
    out.execution = execution;
    if (entries.some((f) => f.kind === "dir" && f.name === "execution")) {
      out.execTasks = await readJsonDir($, join(dir, "execution"), EXEC_TASKS_MAX, (name) => SAFE_TASK.test(name));
    }
    if (entries.some((f) => f.kind === "dir" && f.name === "live")) out.live = await readJsonDir($, join(dir, "live"), LIVE_MAX, () => true);
    if (entries.some((f) => f.kind === "dir" && f.name === "members")) {
      const members = join(dir, "members");
      out.members = await readEach($, members, newestMemberFiles((await listOpt($, members)).filter((f) => f.kind === "file")));
    }
    const parsed3 = parseExecution(execution, now);
    const hook = parsed3?.hookSession;
    if (hook && isSafeId(hook)) {
      const signal = out.live?.[hook] ?? await readSmall($, join(dir, "live", `${hook}.json`), EXEC_FILE_MAX);
      if (signal !== void 0) out.coordinatorLive = signal;
      if (parsed3?.active) {
        const bindings = await claudeBindingTexts($, main, hook, now);
        if (Object.keys(bindings).length) out.coordinatorBindings = bindings;
      }
    }
    return out;
  } catch {
    return {};
  }
}
async function readBandFiles($) {
  const root = await $.session.root();
  const now = await nowMs($);
  const sessionId2 = await sessionIdOf($);
  const projects = await projectEntries($, root, now);
  const project = pickProject(projects.map((p) => p.entry), sessionId2);
  const chosen = projects.find((p) => p.entry.name === project);
  if (!project || !chosen) {
    return { project: null, files: { states: {}, messages: {}, critiques: {}, ...await loadForge($, root, now), sessionId: sessionId2, now } };
  }
  const pdocs = join(root, "docs", "waypoint", project);
  const pstate = join(root, ".waypoint", project);
  const pcrit = join(pdocs, "design", "critiques");
  const critiques = {};
  const places = [[pstate, /^critique-r(\d+)\.json$/], [pcrit, /^r(\d+)\.json$/]];
  for (const [where, re] of places) {
    const found = (await listOpt($, where)).filter((f) => f.kind === "file" && re.test(f.name)).slice(0, MAX_DOCS);
    for (const f of found) {
      const text2 = await readOpt($, join(where, f.name));
      const m = re.exec(f.name);
      if (text2 !== void 0 && m) critiques[`critique-r${Number(m[1])}.json`] = text2;
    }
  }
  const files = {
    plan: await readOpt($, join(pdocs, "plan.yaml")),
    design: await readOpt($, join(pdocs, "design.md")),
    changelog: await readOpt($, join(pdocs, "design", "changelog.json")),
    dismissed: await readOpt($, join(pcrit, "dismissed.json")) ?? await readOpt($, join(pstate, "dismissed.json")),
    ...chosen.seats,
    states: await readCollection($, join(pstate, "dbcache", "state"), "first"),
    // The newest MAX_DOCS: the band reads them again on every 30 s tick, one engine call each, so it does not count
    // every message as the start hook does once per session; an open message older than the newest 500 is rare.
    messages: await readCollection($, join(pstate, "dbcache", "messages"), "last"),
    ...await loadForge($, root, now),
    critiques,
    sessionId: sessionId2,
    now
  };
  return { project, files };
}
async function loadBandModel($) {
  const { project, files } = await readBandFiles($);
  return project ? buildBandModel(project, files) : noneBand(void 0, executionViewer(files));
}

// src/lens/cards.ts
var modelRight = (s, t) => s.model ? `${shortModelName(s.model)}${s.effort ? ` \xB7 ${t.effortLevel(s.effort)}` : ""}` : void 0;
var VERDICT_HUE = { accept: "green", fix: "yellow", redo: "red" };
var VALIDATING = /* @__PURE__ */ new Set(["prep", "review-prep", "validate"]);
function jobText(name, t) {
  return VALIDATING.has(name) ? t.validating : name === "integrate" ? t.integrating : name;
}
function verdictChip(f, t) {
  const v = f.verdict;
  if (!v) return null;
  const n2 = v.round ?? (f.round !== null && f.round >= 1 ? f.round : null);
  const c2 = v.findings;
  const counts2 = c2 ? [`${c2.critical} C`, `${c2.important} I`, ...c2.minor > 0 ? [`${c2.minor} m`] : []] : [];
  const head = v.action === "accept" ? `\u2713 ${n2 !== null ? t.acceptedInRound(n2) : t.accepted}` : [v.action, n2 !== null ? `${t.fixRound} ${n2}${f.reviews?.max ? `/${f.reviews.max}` : ""}` : null].filter(Boolean).join(" \xB7 ");
  return { text: [head, ...counts2].join(" \xB7 "), hue: VERDICT_HUE[v.action] ?? "lavender" };
}
function verifyState(f) {
  const v = f.verify;
  if (!v?.planned) return { skipped: false, noResult: false };
  return { skipped: v.result === "skipped", noResult: v.result === null && v.launched !== true && forgeDone(f) };
}
function forgeSubtitle(f, t) {
  const phase = forgePhase(f);
  if (!phase && f.autonomy !== "auto") return void 0;
  const time2 = f.timing && span(f.timing.taskSeconds) ? `${f.timing.done && phase !== "stopped" ? "\u2713 " : ""}${span(f.timing.taskSeconds)}` : null;
  return [t.sForge, phase === "stopped" ? t.stopped : phase, time2, f.autonomy === "auto" && t.autoMode].filter(Boolean).join(" \xB7 ");
}
function forgeBlocks(m, f, t, linked) {
  const blocks = [];
  const vs = verifyState(f);
  const stages = m.execution?.active && f.path === "large" ? stagesFor("run", "execution") : stagesFor(
    f.path,
    forgePhase(f),
    f.validators.length ? f.validators.every((v) => v.ok) ? "ok" : "failed" : null,
    f.verify?.planned === true && !vs.skipped && !vs.noResult,
    (f.timing?.stages ?? []).map((s) => s.name)
  );
  blocks.push({ kind: "stages", stages, hue: SECTION_HUE.forge });
  const tm = f.timing;
  if (tm && tm.stages.length) {
    const label = (n2) => Object.hasOwn(t.stage, n2) ? t.stage[n2] : n2;
    blocks.push({ kind: "text", text: tm.stages.map((s) => `${label(s.name)} ${span(s.seconds) ?? "0s"}${s.live ? "\u2026" : ""}`).join(" \xB7 "), dim: true });
  }
  if (f.verify?.planned) {
    const v = f.verify;
    const where = `verify ${v.surfaces.join(", ")}`;
    const text2 = v.result === "pass" ? `\u2713 ${where} \xB7 ${v.passed}/${v.total}` : v.result === "fail" ? `\u2717 ${where} \xB7 ${v.passed}/${v.total}` : v.result === "blocked" ? `\u2298 ${where} \xB7 ${t.blocked}: ${v.reason ?? ""}` : vs.skipped ? `\u2298 ${where} \xB7 ${t.skipped}: ${v.reason ?? ""}` : vs.noResult ? `\u2298 ${where} \xB7 ${t.skipped}: ${t.noResult}` : where;
    blocks.push({ kind: "text", text: text2, dim: v.result === null || vs.skipped });
    if (v.evidence) blocks.push({ kind: "text", text: v.evidence, dim: true });
  }
  const c2 = briefCells(f);
  if (c2) {
    blocks.push({ kind: "bar", ratio: ratio(c2.done, c2.total), hue: SECTION_HUE.forge, moving: c2.done < c2.total, label: t.briefs, right: `${c2.done}/${c2.total}` });
    blocks.push({ kind: "cells", cells: c2.cells });
  }
  if (!linked && !forgeDone(f)) {
    if (f.reviewers?.length && f.phase.toLowerCase() === "review") blocks.push({ kind: "text", text: `${t.reviewersLbl}: ${f.reviewers.join(", ")}`, dim: true });
    else if (f.agent) {
      const tier = tierOf(f.agent);
      const live = m.subagents.find((s) => tierOf(s.type).label === tier.label);
      blocks.push({ kind: "row", dot: tier.hue, spinning: !!live, tag: { text: tier.label, hue: tier.hue }, text: live?.description ?? f.agent, right: [live && modelRight(live, t), duration(live?.seconds)].filter(Boolean).join("  ") || void 0 });
    }
  }
  const chips = f.validators.map((v) => ({ text: `${v.ok ? "\u2713" : "\u2717"} ${v.name}${v.cached ? ` \xB7 ${t.cached}` : ""}`, hue: v.ok ? "green" : "red" }));
  const verdict = verdictChip(f, t);
  if (verdict) chips.push(verdict);
  const verdictRound = f.verdict ? f.verdict.round ?? (f.round !== null && f.round >= 1 ? f.round : null) : null;
  if (f.round !== null && f.round !== verdictRound) chips.push({ text: `${t.fixRound} ${f.round}${f.cap !== null ? `/${f.cap}` : ""}`, hue: f.cap !== null && f.round >= f.cap ? "red" : "sub" });
  if (chips.length) blocks.push({ kind: "chips", chips });
  return blocks;
}
function runBlocks(m, t) {
  const blocks = [];
  const inf = m.infinite;
  if (inf?.active) {
    const right = [inf.cyclesMax !== null ? `${inf.cycle}/${inf.cyclesMax}` : `${inf.cycle}`, inf.hoursLeft !== null && t.hoursLeft(inf.hoursLeft)].filter(Boolean).join(" \xB7 ");
    blocks.push({ kind: "bar", ratio: inf.cyclesMax ? ratio(inf.cycle - 1, inf.cyclesMax) : 0, hue: "mauve", moving: true, label: `\u221E ${t.cycle}`, right });
    for (const title of inf.autoApproved) blocks.push({ kind: "row", dot: "green", tag: { text: t.auto, hue: "green" }, text: title });
  }
  const dec2 = m.decisions;
  if (dec2) {
    blocks.push({ kind: "row", dot: "yellow", tag: { text: `\u2691 ${t.auto}`, hue: "yellow" }, text: t.autoDecisions(dec2.count) });
    if (dec2.lastMajor) blocks.push({ kind: "text", text: dec2.lastMajor, dim: true });
  }
  return blocks;
}
function agentRow(g, t) {
  const tier = tierOf(g.type);
  return {
    kind: "row",
    dot: tier.hue,
    spinning: g.status === "running",
    tag: { text: tier.label, hue: tier.hue },
    text: g.description || g.type || "?",
    right: [g.model ? shortModelName(g.model) : null, g.tool, g.status === "waiting" ? t.waitingLbl : null, short(g.seconds)].filter(Boolean).join(" \xB7 ") || void 0,
    indent: true
  };
}
function activityRow(a, t) {
  const hue = PATH_HUE[a.path ?? ""] ?? "peach";
  const stage = a.stage ? Object.hasOwn(t.stage, a.stage) ? t.stage[a.stage] : a.stage : null;
  const doing = a.job ? jobText(a.job.name, t) : a.stopped ? t.stopped : a.done ? null : [stage, a.round ? `r${a.round}` : null].filter(Boolean).join(" ") || null;
  return {
    kind: "row",
    dot: a.done ? "green" : a.stopped ? "s2" : hue,
    spinning: a.owner === "own" && !a.done && !a.stopped && a.agents.some((g) => g.status === "running"),
    tag: { text: a.task ?? "wf", hue },
    text: `${a.done ? "\u2713 " : ""}${a.title ?? ""}`,
    right: [a.path, doing, short(a.job ? a.job.seconds : a.seconds), a.owner === "other" ? t.otherSession : null].filter(Boolean).join(" \xB7 ") || void 0,
    dim: a.dim
  };
}
function tasksCard(m, rows, t) {
  const blocks = [];
  const f = m.forge;
  for (const a of rows) {
    blocks.push(activityRow(a, t));
    if (a.owner === "own" && !a.done && !a.stopped) for (const g of a.agents) blocks.push(agentRow(g, t));
    if (a.expanded && f && a.owner !== "other") blocks.push(...forgeBlocks(m, f, t, a.agents.length > 0));
  }
  blocks.push(...runBlocks(m, t));
  const head = rows.find((a) => a.expanded && a.owner !== "other");
  return {
    id: "tasks",
    icon: SECTION_ICON.forge,
    title: `${t.sTasksInProgress} \xB7 ${rows.length}`,
    hue: SECTION_HUE.forge,
    chip: head?.path ? { text: head.path, hue: PATH_HUE[head.path] ?? "peach" } : m.infinite?.active ? { text: "\u221E", hue: "mauve" } : void 0,
    subtitle: f && head ? forgeSubtitle(f, t) : void 0,
    blocks
  };
}
function buildCards(m, t, nowMs2) {
  const out = [];
  let usageCard = null;
  if (m.mainModel || m.tool || m.turnSeconds !== null || m.waiting || m.jobs?.length) {
    const blocks = [];
    if (m.mainModel) blocks.push({ kind: "row", dot: "lavender", text: `${shortModelName(m.mainModel.model)}${m.mainModel.effort ? ` \xB7 ${t.effort} ${t.effortLevel(m.mainModel.effort)}` : ""}` });
    if (m.tool) blocks.push({ kind: "row", dot: "sky", spinning: true, tag: { text: t.tool, hue: "sky" }, text: m.tool.name, right: duration(m.tool.seconds) ?? void 0 });
    if (m.turnSeconds !== null) blocks.push({ kind: "row", dot: "sub", text: t.turn, right: duration(m.turnSeconds) ?? void 0 });
    if (m.waiting) blocks.push({ kind: "row", dot: "yellow", text: t.waitingOn(m.waiting.agents, short(m.waiting.wakeSeconds)) });
    for (const j of (m.jobs ?? []).slice(0, 5)) {
      blocks.push({ kind: "row", dot: "sky", spinning: true, text: [jobText(j.name, t), j.task].filter(Boolean).join(" "), right: short(j.seconds) ?? void 0 });
    }
    out.push({ id: "now", icon: SECTION_ICON.now, title: t.sNow, hue: SECTION_HUE.now, blocks });
  }
  if (m.waypoint) {
    const w = m.waypoint;
    const cells2 = roadmapCells(w);
    const blocks = [{
      kind: "bar",
      ratio: w.percent / 100,
      hue: SECTION_HUE.roadmap,
      moving: !!w.current,
      label: w.track ? `${t.track} ${w.track}` : w.run ? t.integratedN : void 0,
      right: `${w.trackDone}/${w.trackTotal}`
    }];
    if (cells2.total) blocks.push({ kind: "cells", cells: cells2.cells });
    if (w.current) {
      const started = w.current.startedAt ? Date.parse(w.current.startedAt) : NaN;
      const min = Number.isFinite(started) && nowMs2 >= started ? Math.floor((nowMs2 - started) / 6e4) : null;
      const right = min !== null ? `${min}${w.current.estimateMin ? `/${w.current.estimateMin}` : ""} min` : void 0;
      blocks.push({ kind: "row", dot: "peach", spinning: true, tag: { text: w.current.id, hue: "peach" }, text: w.current.title, right });
    } else if (!w.run) {
      blocks.push({ kind: "text", text: t.noTask, dim: true });
    }
    for (const r of w.recentDone ?? []) {
      const over = r.estimateMin !== void 0 && r.minutes > r.estimateMin;
      blocks.push({ kind: "text", text: `\u2713 ${r.id} \xB7 ${r.minutes > 1440 ? ">24h" : r.minutes}${r.estimateMin ? `/${r.estimateMin}` : ""} min`, dim: true, ...over ? { hue: "yellow" } : {} });
    }
    const chips = [];
    if (w.inbox > 0) chips.push({ text: `\u270E ${w.inbox}`, hue: "blue" });
    if (w.escalation) chips.push({ text: `\u25B2 ${t.decision}`, hue: "red" });
    if (chips.length) blocks.push({ kind: "chips", chips });
    out.push({
      id: "roadmap",
      icon: SECTION_ICON.roadmap,
      title: w.project,
      hue: SECTION_HUE.roadmap,
      chip: { text: `${w.percent}%`, hue: SECTION_HUE.roadmap },
      subtitle: w.phase ? `${t.phase} ${w.phase.index}/${w.phase.total} \xB7 ${w.phase.name}` : void 0,
      blocks
    });
  }
  const rows = (m.activities ?? []).filter((a) => (a.kind === "forge" || a.kind === "workflow") && !a.slot);
  if (rows.length) out.push(tasksCard(m, rows, t));
  else if (m.forge || m.infinite?.active || m.decisions) {
    const f = m.forge;
    out.push({
      id: "tasks",
      icon: SECTION_ICON.forge,
      title: f?.task ?? "forge",
      hue: SECTION_HUE.forge,
      chip: f?.path ? { text: f.path, hue: PATH_HUE[f.path] ?? "peach" } : m.infinite?.active ? { text: "\u221E", hue: "mauve" } : void 0,
      subtitle: f ? forgeSubtitle(f, t) : void 0,
      blocks: [...f ? forgeBlocks(m, f, t, false) : [], ...runBlocks(m, t)]
    });
  }
  if (m.execution) {
    const x = m.execution;
    const HUE = { alive: "green", silent: "yellow", stopped: "red" };
    const stage = (s) => t.stage[s] ?? s;
    const blocks = [{
      kind: "bar",
      ratio: ratio(x.slots.length, x.parallel),
      hue: "teal",
      moving: x.active && x.slots.length > 0,
      label: `${x.mode === "sessions" ? t.modeSessions : t.modeSubagents} ${x.slots.length}/${x.parallel}`,
      // F-10: integrated out of the total, as the band says it; the accepted ones are listed below («to integrate»).
      right: `${x.integrated}/${x.total} ${t.integratedN}`
    }];
    if (x.stallReason) blocks.push({ kind: "text", text: x.stallReason, dim: false });
    const dim = x.dim ? { dim: true } : {};
    for (const s of x.slots) {
      blocks.push({
        kind: "row",
        dot: HUE[s.liveness],
        spinning: s.liveness === "alive",
        tag: { text: s.task, hue: HUE[s.liveness] },
        text: s.title ?? "",
        right: [
          stage(s.stage),
          s.agent ? tierOf(s.agent).label : null,
          duration(s.seconds),
          s.taskSeconds != null && span(s.taskSeconds) ? `${t.taskTime} ${span(s.taskSeconds)}` : null,
          s.round ? `r${s.round}` : null
        ].filter(Boolean).join(" \xB7 "),
        ...dim
      });
      for (const g of s.agents ?? []) blocks.push({ ...agentRow(g, t), ...dim });
    }
    for (const s of x.manual) {
      blocks.push({
        kind: "row",
        dot: HUE[s.liveness],
        spinning: s.liveness === "alive",
        text: `${t.manualRow} \xB7 ${s.task}${s.title ? ` ${s.title}` : ""}`,
        right: [stage(s.stage), duration(s.seconds)].filter(Boolean).join(" \xB7 "),
        ...dim
      });
    }
    if (x.finished?.length) blocks.push({ kind: "text", text: `\u2713 ${x.finished.map((f) => `${f.task} ${span(f.seconds) ?? "0s"}`).join(" \xB7 ")}`, dim: true });
    const list = (label, ids) => {
      if (ids.length) blocks.push({ kind: "text", text: `${label}: ${ids.join(", ")}`, dim: true });
    };
    list(t.queued, x.queued);
    list(t.conflictsLbl, x.conflicts);
    list(t.blockedLbl, x.blocked);
    list(t.orphans, x.orphans);
    const coord = x.coordinator.liveness;
    out.push({
      id: "execution",
      icon: "\u25BA",
      title: t.sExecution,
      hue: "teal",
      chip: { text: coord === "alive" ? t.alive : coord === "silent" ? t.silent : t.stopped, hue: HUE[coord] },
      subtitle: x.elapsedSeconds != null && span(x.elapsedSeconds) ? `\u25F7 ${span(x.elapsedSeconds)}` : void 0,
      blocks
    });
  }
  if (m.usage) {
    const u = m.usage;
    const loc = m.locale;
    const usd = (v) => v === null ? "\u2014" : fmtUsd(v, loc);
    const name = (g) => {
      if (g.model === null) return "";
      const effort = !g.effort ? "" : ` \xB7 ${g.effort === "varios" ? t.various : t.effortLevel(g.effort)}`;
      return `${g.model === "varios" ? t.various : shortModelName(g.model)}${effort}`;
    };
    const forgeGroups = u.groups.some((g) => g.id === "impl" || g.id === "review" || g.id === "plan");
    const label = { main: t.gMain, impl: t.gImpl, review: t.gReview, verify: t.gVerify, plan: t.gPlan, other: forgeGroups ? t.gOther : t.sSubagents };
    const blocks = [{
      kind: "bar",
      ratio: 1,
      hue: "teal",
      label: u.scope === "run" ? t.run : t.thisSession,
      right: `${fmtTokens(u.tokens, loc)} tok \xB7 ${u.partial ? "\u2265 " : ""}${fmtUsd(u.costUsd, loc)}`
    }];
    if (u.time) {
      const tm = u.time;
      const line = (active, partial, since) => `\u25F7 ${t.active} ${partial ? "\u2265 " : ""}${span(active) ?? "0s"}${since !== null && span(since) ? ` \xB7 ${t.sinceStart} ${span(since)}` : ""}`;
      blocks.push({ kind: "text", text: line(tm.activeSeconds, tm.activePartial, tm.sinceStartSeconds) });
      if (tm.session) blocks.push({ kind: "text", text: `${t.thisSession}: ${line(tm.session.activeSeconds, false, tm.session.sinceStartSeconds)}`, dim: true });
    }
    if (u.session) blocks.push({ kind: "text", text: `${t.thisSession}: ${fmtTokens(u.session.tokens, loc)} tok \xB7 ${u.sessionPartial ? "\u2265 " : ""}${fmtUsd(u.session.costUsd, loc)}`, dim: true });
    if (u.officialUsd !== null) blocks.push({ kind: "text", text: `${u.drift ? "\u25B2 " : ""}/cost ${fmtUsd(u.officialUsd, loc)}${u.drift ? ` \xB7 ${t.drift}` : ""}`, dim: !u.drift });
    for (const g of u.groups) {
      blocks.push({ kind: "row", dot: "teal", tag: { text: label[g.id], hue: "teal" }, text: name(g), right: `${fmtTokens(g.tokens, loc)} \xB7 ${usd(g.costUsd)} \xB7 ${Math.round(g.share * 100)} %` });
    }
    if (u.tracking) blocks.push({ kind: "row", dot: "s2", tag: { text: `${t.tracking} \u2248`, hue: "s2" }, text: "waypoint+forge", right: `~${fmtTokens(u.tracking.tokens, loc)} \xB7 ${usd(u.tracking.costUsd)}` });
    if (u.withoutForge) {
      const w = u.withoutForge;
      const diff = u.partial ? t.noReview : w.deltaUsd >= 0 ? t.forgeCosts(fmtUsd(w.deltaUsd, loc), w.deltaPct) : t.forgeSaves(fmtUsd(-w.deltaUsd, loc));
      const est = w.lowUsd !== void 0 && w.lowUsd < w.costUsd - 5e-3 ? fmtUsdRange(w.lowUsd, w.costUsd, loc) : fmtUsd(w.costUsd, loc);
      blocks.push({ kind: "text", text: `${t.withoutForge}: ~${est} \xB7 ${diff}` });
      blocks.push({ kind: "text", text: t.withoutForgeNote, dim: true });
    }
    blocks.push({ kind: "text", text: `${t.pricesAsOf} ${u.pricesAsOf}`, dim: true });
    usageCard = { id: "usage", icon: "$", title: t.sUsage, hue: "teal", chip: { text: `${u.partial ? "\u2265 " : ""}${fmtUsd(u.costUsd, loc)}`, hue: "teal" }, blocks };
  }
  if (m.superpowers) {
    const s = m.superpowers;
    const c2 = superpowersCells(s);
    const n2 = s.current ? s.current.task : String(s.done < s.tasks ? s.done + 1 : s.done);
    const blocks = [
      { kind: "bar", ratio: ratio(c2.done, c2.total), hue: SECTION_HUE.superpowers, moving: s.done < s.tasks, label: `${t.task} ${n2}/${s.tasks}`, right: `${s.done} ${t.done}` },
      { kind: "cells", cells: c2.cells }
    ];
    if (s.current) blocks.push({ kind: "chips", chips: [{ text: `${t.fixRound} ${s.current.round}${s.current.cap ? `/${s.current.cap}` : ""}`, hue: "yellow" }] });
    if (s.stale) blocks.push({ kind: "text", text: t.staleLedger, dim: true });
    for (const line of s.lastLines) blocks.push({ kind: "text", text: line, dim: true });
    out.push({ id: "superpowers", icon: SECTION_ICON.superpowers, title: s.plan || t.sSuperpowers, hue: SECTION_HUE.superpowers, chip: { text: `${Math.round(ratio(s.done, s.tasks) * 100)}%`, hue: SECTION_HUE.superpowers }, blocks });
  }
  if (m.todos) {
    const td = m.todos;
    const c2 = todoCells(td);
    const blocks = [{ kind: "bar", ratio: ratio(td.done, td.total), hue: SECTION_HUE.todos, moving: !!td.inProgress }, { kind: "cells", cells: c2.cells }];
    for (const text2 of td.active ?? (td.inProgress ? [td.inProgress] : [])) blocks.push({ kind: "row", dot: "peach", spinning: true, text: text2 });
    for (const next of td.next) blocks.push({ kind: "row", dot: "s2", text: next });
    out.push({ id: "todos", icon: SECTION_ICON.todos, title: t.sTodos, hue: SECTION_HUE.todos, chip: { text: `${td.done}/${td.total}`, hue: SECTION_HUE.todos }, blocks });
  }
  const done = m.subagentsDone ?? [];
  const loose = m.subagents.filter((s) => !s.shown);
  if (loose.length || done.length) {
    const blocks = loose.slice(-10).map((s) => {
      const tier = tierOf(s.type);
      const waiting = s.status === "waiting" || s.status === "idle";
      return {
        kind: "row",
        dot: tier.hue,
        spinning: !waiting,
        tag: { text: tier.label, hue: tier.hue },
        text: `${s.task ? `[${s.task}] ` : ""}${s.description || s.type || "?"}`,
        right: [modelRight(s, t), waiting ? t.waitingLbl : null, duration(s.seconds)].filter(Boolean).join("  ") || void 0
      };
    });
    for (const d of done) {
      const text2 = ["\u2713 " + tierOf(d.type).label, d.description, d.model ? shortModelName(d.model) : null, span(d.seconds)].filter(Boolean).join(" \xB7 ");
      blocks.push({ kind: "text", text: text2, dim: true });
    }
    out.push({
      id: "agents",
      icon: SECTION_ICON.agents,
      title: t.sSubagents,
      hue: SECTION_HUE.agents,
      chip: m.subagents.length ? { text: String(m.subagents.length), hue: SECTION_HUE.agents } : void 0,
      blocks
    });
  }
  if (m.ccTasks) {
    const cc = m.ccTasks;
    const blocks = [
      { kind: "bar", ratio: ratio(cc.done, cc.done + cc.open), hue: SECTION_HUE.tasks, label: `${cc.open} ${t.open}`, right: `${cc.done} ${t.done}` },
      ...cc.recent.map((r) => ({ kind: "row", dot: "teal", text: r }))
    ];
    out.push({ id: "ccTasks", icon: SECTION_ICON.tasks, title: t.sTasks, hue: SECTION_HUE.tasks, blocks });
  }
  if (usageCard) out.push(usageCard);
  return out;
}
function cardAlt(card) {
  const parts = [card.title];
  if (card.chip) parts.push(card.chip.text);
  if (card.subtitle) parts.push(card.subtitle);
  for (const b of card.blocks) {
    if (b.kind === "bar") parts.push([b.label, b.right].filter(Boolean).join(" "));
    else if (b.kind === "cells") parts.push(`${b.cells.filter((c2) => c2 === "done").length}/${b.cells.length}`);
    else if (b.kind === "stages") parts.push(b.stages.map((s) => s.state === "active" ? `[${s.name}]` : s.name).join(" \u2192 "));
    else if (b.kind === "row") parts.push([b.tag?.text, b.text, b.right].filter(Boolean).join(" "));
    else if (b.kind === "text") parts.push(b.text);
    else parts.push(b.chips.map((c2) => c2.text).join(", "));
  }
  return parts.filter(Boolean).join(" \xB7 ");
}

// src/lens/svg.ts
var FONT = "system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";
var MONO = "ui-monospace,'SF Mono','Cascadia Code',Consolas,monospace";
var xml = (s) => String(s).replace(/[&<>"']/g, (c2) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c2]);
var charW = (size) => size * 0.56;
function fit(s, size, maxW) {
  const max = Math.max(1, Math.floor(maxW / charW(size)));
  return s.length <= max ? s : `${s.slice(0, Math.max(1, max - 1))}\u2026`;
}
var vars = (p) => Object.entries(p).map(([k, v]) => `--${k}:${v}`).join(";");
var STYLE = `<style>
svg{${vars(PALETTE)}}
@media (prefers-color-scheme: light){svg{${vars(LATTE)}}}
.t{fill:var(--text)}.m{fill:var(--sub)}.o{fill:var(--o0)}
.sheen{animation:sheen 2.4s cubic-bezier(.4,0,.2,1) infinite}
@keyframes sheen{0%{transform:translateX(-120px)}70%,100%{transform:translateX(var(--run,600px))}}
.breathe{animation:breathe 1.6s ease-in-out infinite}
@keyframes breathe{0%,100%{opacity:1}50%{opacity:.35}}
.glow{animation:glow 1.6s ease-in-out infinite}
@keyframes glow{0%,100%{opacity:.55}50%{opacity:0}}
.spin{animation:spin 1s linear infinite;transform-box:fill-box;transform-origin:center}
@keyframes spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion: reduce){.sheen,.breathe,.glow,.spin{animation:none}.sheen{display:none}}
</style>`;
var c = (hue) => `var(--${hue})`;
var PAD = 14;
var HEAD_H = 34;
var BAR_H = 10;
var CELL2 = 12;
var CELL_GAP = 4;
function blockHeight(b, inner) {
  switch (b.kind) {
    case "bar":
      return (b.label || b.right ? 18 : 0) + BAR_H + 10;
    case "cells": {
      const per = Math.max(1, Math.floor((inner + CELL_GAP) / (CELL2 + CELL_GAP)));
      return Math.ceil(b.cells.length / per) * (CELL2 + CELL_GAP) + 6;
    }
    case "stages":
      return 40;
    case "row":
      return 24;
    case "text":
      return 20;
    case "chips":
      return 26;
  }
}
function drawBlock(b, x, y, inner, id2) {
  switch (b.kind) {
    case "bar": {
      let out = "";
      let top = y;
      if (b.label || b.right) {
        if (b.label) out += `<text class="m" x="${x}" y="${y + 12}" font-family="${FONT}" font-size="11.5">${xml(fit(b.label, 11.5, inner * 0.7))}</text>`;
        if (b.right) out += `<text class="t" x="${x + inner}" y="${y + 12}" text-anchor="end" font-family="${MONO}" font-size="11.5" font-weight="600">${xml(b.right)}</text>`;
        top += 18;
      }
      const w = Math.round(inner * Math.max(0, Math.min(1, b.ratio)));
      out += `<rect x="${x}" y="${top}" width="${inner}" height="${BAR_H}" rx="${BAR_H / 2}" style="fill:var(--s0)"/>`;
      if (w > 0) {
        out += `<defs><linearGradient id="g${id2}" x1="0" x2="1"><stop offset="0" style="stop-color:${c(b.hue)};stop-opacity:.75"/><stop offset="1" style="stop-color:${c(b.hue)}"/></linearGradient><clipPath id="k${id2}"><rect x="${x}" y="${top}" width="${w}" height="${BAR_H}" rx="${BAR_H / 2}"/></clipPath><linearGradient id="s${id2}" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs><rect x="${x}" y="${top}" width="${w}" height="${BAR_H}" rx="${BAR_H / 2}" fill="url(#g${id2})"/>`;
        if (b.moving) out += `<g clip-path="url(#k${id2})"><rect class="sheen" style="--run:${w + 140}px" x="${x}" y="${top}" width="80" height="${BAR_H}" fill="url(#s${id2})"/></g>`;
      }
      return out;
    }
    case "cells": {
      const per = Math.max(1, Math.floor((inner + CELL_GAP) / (CELL2 + CELL_GAP)));
      return b.cells.map((s, i) => {
        const cx = x + i % per * (CELL2 + CELL_GAP);
        const cy = y + Math.floor(i / per) * (CELL2 + CELL_GAP);
        const hue = STATE_HUE[s];
        const base = s === "pending" ? `<rect x="${cx + 0.5}" y="${cy + 0.5}" width="${CELL2 - 1}" height="${CELL2 - 1}" rx="3" style="fill:none;stroke:var(--s2)"/>` : `<rect x="${cx}" y="${cy}" width="${CELL2}" height="${CELL2}" rx="3" style="fill:${c(hue)}"${s === "active" ? ' class="breathe"' : ""}/>`;
        const halo = s === "active" ? `<rect class="glow" x="${cx - 2}" y="${cy - 2}" width="${CELL2 + 4}" height="${CELL2 + 4}" rx="5" style="fill:none;stroke:${c(hue)};stroke-width:1.5"/>` : "";
        return `${base}${halo}<title>${s}</title>`;
      }).join("");
    }
    case "stages": {
      const n2 = b.stages.length;
      const step = n2 > 1 ? inner / (n2 - 1) : 0;
      let out = `<line x1="${x + 6}" y1="${y + 9}" x2="${x + inner - 6}" y2="${y + 9}" style="stroke:var(--s1);stroke-width:2"/>`;
      const doneTo = b.stages.reduce((k, s, i) => s.state !== "pending" ? i : k, 0);
      if (doneTo > 0) out += `<line x1="${x + 6}" y1="${y + 9}" x2="${x + step * doneTo}" y2="${y + 9}" style="stroke:${c(b.hue)};stroke-width:2"/>`;
      b.stages.forEach((s, i) => {
        const cx = n2 > 1 ? x + step * i : x + inner / 2;
        const anchor = i === 0 ? "start" : i === n2 - 1 ? "end" : "middle";
        const tx = i === 0 ? cx - 6 : i === n2 - 1 ? cx + 6 : cx;
        const cxx = i === 0 ? cx + 6 : i === n2 - 1 ? cx - 6 : cx;
        if (s.state === "done") out += `<circle cx="${cxx}" cy="${y + 9}" r="6" style="fill:${c(b.hue)}"/><path d="M${cxx - 3} ${y + 9}l2 2 4-4" style="fill:none;stroke:var(--base);stroke-width:1.6;stroke-linecap:round"/>`;
        else if (s.state === "active") out += `<circle class="glow" cx="${cxx}" cy="${y + 9}" r="10" style="fill:${c(b.hue)}"/><circle cx="${cxx}" cy="${y + 9}" r="6.5" style="fill:${c(b.hue)}"/><circle cx="${cxx}" cy="${y + 9}" r="2.5" style="fill:var(--base)"/>`;
        else out += `<circle cx="${cxx}" cy="${y + 9}" r="5.5" style="fill:var(--base);stroke:var(--s2);stroke-width:1.5"/>`;
        out += `<text class="${s.state === "pending" ? "o" : "t"}" x="${tx}" y="${y + 32}" text-anchor="${anchor}" font-family="${FONT}" font-size="10.5"${s.state === "active" ? ' font-weight="700"' : ""}>${xml(s.name)}</text>`;
      });
      return out;
    }
    case "row": {
      let out = "";
      const left = b.indent ? x + 14 : x;
      const cy = y + 11;
      if (b.spinning) out += `<g class="spin"><circle cx="${left + 6}" cy="${cy}" r="5.5" style="fill:none;stroke:${c(b.dot)};stroke-width:2;stroke-dasharray:22 13;stroke-linecap:round"/></g>`;
      else out += `<circle cx="${left + 6}" cy="${cy}" r="4.5" style="fill:${c(b.dot)}"/>`;
      let tx = left + 18;
      if (b.tag) {
        const tw = Math.round(b.tag.text.length * charW(10.5) + 12);
        out += `<rect x="${tx}" y="${cy - 8}" width="${tw}" height="16" rx="8" style="fill:${c(b.tag.hue)};fill-opacity:.18;stroke:${c(b.tag.hue)};stroke-opacity:.6"/><text x="${tx + tw / 2}" y="${cy + 3.6}" text-anchor="middle" font-family="${FONT}" font-size="10.5" font-weight="600" style="fill:${c(b.tag.hue)}">${xml(b.tag.text)}</text>`;
        tx += tw + 8;
      }
      const rightW = b.right ? b.right.length * charW(11) + 10 : 0;
      out += `<text class="${b.dim ? "m" : "t"}" x="${tx}" y="${cy + 4}" font-family="${FONT}" font-size="12">${xml(fit(b.text, 12, x + inner - tx - rightW))}</text>`;
      if (b.right) out += `<text class="m" x="${x + inner}" y="${cy + 4}" text-anchor="end" font-family="${MONO}" font-size="11">${xml(b.right)}</text>`;
      return out;
    }
    case "text":
      return `<text class="${b.dim ? "m" : "t"}"${b.hue ? ` style="fill:${c(b.hue)}"` : ""} x="${x}" y="${y + 14}" font-family="${FONT}" font-size="12">${xml(fit(b.text, 12, inner))}</text>`;
    case "chips": {
      let cx = x;
      let out = "";
      for (const chip of b.chips) {
        const tw = Math.round(chip.text.length * charW(11) + 16);
        if (cx + tw > x + inner) break;
        out += `<rect x="${cx}" y="${y + 3}" width="${tw}" height="19" rx="9.5" style="fill:${c(chip.hue)};fill-opacity:.16;stroke:${c(chip.hue)};stroke-opacity:.55"/><text x="${cx + tw / 2}" y="${y + 16.5}" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="600" style="fill:${c(chip.hue)}">${xml(chip.text)}</text>`;
        cx += tw + 6;
      }
      return out;
    }
  }
}
function cardSvg(card, W) {
  const id2 = "l";
  const inner = W - PAD * 2;
  const heights = card.blocks.map((b) => blockHeight(b, inner));
  const H = HEAD_H + (card.subtitle ? 16 : 0) + heights.reduce((a, b) => a + b, 0) + PAD - 4;
  let y = HEAD_H + (card.subtitle ? 16 : 0);
  const body = card.blocks.map((b, i) => {
    const out = drawBlock(b, PAD, y, inner, `${id2}${i}`);
    y += heights[i];
    return out;
  }).join("");
  const chipW = card.chip ? Math.round(card.chip.text.length * charW(10.5) + 16) : 0;
  const head = `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12" style="fill:var(--mantle);stroke:var(--s0)"/><rect x="0.5" y="0.5" width="4" height="${H - 1}" rx="2" style="fill:${c(card.hue)}"/><rect x="${PAD}" y="9" width="20" height="20" rx="6" style="fill:${c(card.hue)};fill-opacity:.18"/><text x="${PAD + 10}" y="23.5" text-anchor="middle" font-family="${FONT}" font-size="12" style="fill:${c(card.hue)}">${xml(card.icon)}</text><text class="t" x="${PAD + 28}" y="23.5" font-family="${FONT}" font-size="13" font-weight="700">${xml(fit(card.title, 13, inner - 40 - chipW))}</text>` + (card.chip ? `<rect x="${W - PAD - chipW}" y="10" width="${chipW}" height="18" rx="9" style="fill:${c(card.chip.hue)}"/><text x="${W - PAD - chipW / 2}" y="22.5" text-anchor="middle" font-family="${FONT}" font-size="10.5" font-weight="700" style="fill:var(--base)">${xml(card.chip.text)}</text>` : "") + (card.subtitle ? `<text class="m" x="${PAD}" y="${HEAD_H + 8}" font-family="${FONT}" font-size="11.5">${xml(fit(card.subtitle, 11.5, inner))}</text>` : "");
  return {
    source: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${STYLE}${head}${body}</svg>`,
    height: H
  };
}
function bandSvg(o) {
  const H = 30;
  const id2 = "b";
  const titleW = Math.min(o.W * 0.32, Math.max(80, (o.title.length + 2) * charW(12.5)));
  const pctText = `${Math.round(o.ratio * 100)}%`;
  const right = 46;
  const barX = 30 + titleW + 10;
  const cellsW = o.cells.length ? Math.min(o.cells.length, 24) * 9 + 8 : 0;
  const detailW = o.detail ? Math.min(o.W * 0.22, o.detail.length * charW(11) + 10) : 0;
  const barW = Math.max(60, o.W - barX - right - cellsW - detailW - 10);
  const w = Math.round(barW * Math.max(0, Math.min(1, o.ratio)));
  const by = (H - 8) / 2;
  let s = `<circle cx="11" cy="${H / 2}" r="9" style="fill:${c(o.hue)};fill-opacity:.2"/><text x="11" y="${H / 2 + 4}" text-anchor="middle" font-family="${FONT}" font-size="11" style="fill:${c(o.hue)}">${xml(o.icon)}</text><text class="t" x="26" y="${H / 2 + 4.5}" font-family="${FONT}" font-size="12.5" font-weight="600">${xml(fit(o.title, 12.5, titleW))}</text>` + (o.cells.length ? `<rect x="${barX}" y="${by}" width="${barW}" height="8" rx="4" style="fill:var(--s0)"/>` : "");
  if (w > 0 && o.cells.length) {
    s += `<defs><linearGradient id="g${id2}" x1="0" x2="1"><stop offset="0" style="stop-color:${c(o.hue)};stop-opacity:.7"/><stop offset="1" style="stop-color:${c(o.hue)}"/></linearGradient><clipPath id="k${id2}"><rect x="${barX}" y="${by}" width="${w}" height="8" rx="4"/></clipPath><linearGradient id="s${id2}" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".6"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs><rect x="${barX}" y="${by}" width="${w}" height="8" rx="4" fill="url(#g${id2})"/>`;
    if (o.moving) s += `<g clip-path="url(#k${id2})"><rect class="sheen" style="--run:${w + 140}px" x="${barX}" y="${by}" width="70" height="8" fill="url(#s${id2})"/></g>`;
  }
  let x = barX + barW + 10;
  for (const st of o.cells.slice(0, 24)) {
    s += st === "pending" ? `<rect x="${x + 0.5}" y="${H / 2 - 3.5}" width="6" height="7" rx="1.5" style="fill:none;stroke:var(--s2)"/>` : `<rect x="${x}" y="${H / 2 - 4}" width="7" height="8" rx="1.5" style="fill:${c(STATE_HUE[st])}"${st === "active" ? ' class="breathe"' : ""}/>`;
    x += 9;
  }
  if (o.detail) s += `<text class="m" x="${x + 2}" y="${H / 2 + 4}" font-family="${FONT}" font-size="11">${xml(fit(o.detail, 11, detailW))}</text>`;
  s += `<text class="t" x="${o.W - 4}" y="${H / 2 + 4.5}" text-anchor="end" font-family="${MONO}" font-size="12" font-weight="700">${xml(o.label || pctText)}</text>`;
  return { source: `<svg xmlns="http://www.w3.org/2000/svg" width="${o.W}" height="${H}" viewBox="0 0 ${o.W} ${H}">${STYLE}${s}</svg>`, height: H };
}

// src/lens/layout.ts
var COMPACT_BELOW = 56;
var DOCK_COLUMNS = 56;
var DOCK_MIN_COLUMNS = 110;
var PANE_ROWS_MIN = 6;
var MIN_COLUMNS = 20;
var SUMMARY_CELLS = 8;
var CARD_PRIORITY = ["now", "tasks", "execution", "roadmap", "agents", "superpowers", "todos", "ccTasks", "usage"];
function panelLayout(props, viewport) {
  const placement = props?.placement === "inline" ? "inline" : "dock";
  const fallback = { cols: MIN_COLUMNS, rows: null, placement, compact: true, boxed: false, focusAgent: null };
  try {
    const raw = Number(props?.bodyColumns);
    if (!Number.isFinite(raw) || raw <= 0) return fallback;
    const cols = Math.max(MIN_COLUMNS, Math.floor(raw));
    const bodyRows = Number(props?.scroll?.bodyRows);
    const rows = placement === "inline" && Number.isFinite(bodyRows) && bodyRows > 0 ? Math.floor(bodyRows) : null;
    const compact = placement === "inline" || cols < COMPACT_BELOW || viewport?.isFullscreen === false;
    const agent = props?.view?.agentId;
    return { cols, rows, placement, compact, boxed: !compact, focusAgent: typeof agent === "string" && agent ? agent : null };
  } catch {
    return fallback;
  }
}
var innerWidth = (layout) => Math.max(6, layout.cols - (layout.boxed ? 4 : 2));
var cellsMax = (inner) => 2 * Math.max(1, Math.floor(inner / 2));
function fitCells(cells2, max) {
  const limit = max === Number.POSITIVE_INFINITY ? cells2.length : Number.isFinite(max) ? Math.max(1, Math.floor(max)) : 1;
  if (cells2.length <= limit) return { cells: [...cells2], more: null };
  const size = Math.max(1, limit - SUMMARY_CELLS);
  const first = cells2.findIndex((c2) => c2 === "active" || c2 === "pending");
  const focus = first < 0 ? cells2.length - size : first;
  const start = Math.max(0, Math.min(focus - 2, cells2.length - size));
  const left = [...cells2.slice(0, start), ...cells2.slice(start + size)];
  const empty = left.filter((c2) => c2 === "pending").length;
  const filled = left.length - empty;
  const counts2 = [filled ? `${filled} \u25A0` : "", empty ? `${empty} \u25A1` : ""].filter(Boolean);
  return { cells: cells2.slice(start, start + size), more: counts2.length ? `+${counts2.join(" \xB7 ")}` : null };
}
function blockRows(b, inner) {
  if (b.kind === "bar") return b.label || b.right ? 2 : 1;
  if (b.kind === "cells") {
    if (!b.cells.length) return 0;
    const fit2 = fitCells(b.cells, cellsMax(inner));
    return Math.min(2, Math.ceil(fit2.cells.length * 2 / Math.max(2, inner))) + (fit2.more ? 1 : 0);
  }
  return 1;
}
function cardRows(card, layout) {
  const inner = innerWidth(layout);
  return 1 + (card.subtitle ? 1 : 0) + (layout.boxed ? 2 : 0) + card.blocks.reduce((n2, b) => n2 + blockRows(b, inner), 0);
}
function fitCards(cards, layout) {
  try {
    if (layout.rows === null) return { cards, hidden: 0 };
    const total = (cs) => cs.reduce((n2, c2) => n2 + cardRows(c2, layout), 0);
    const before = total(cards);
    if (before <= layout.rows) return { cards, hidden: 0 };
    const budget = Math.max(0, layout.rows - 1);
    const out = cards.map((c2) => ({ ...c2, blocks: [...c2.blocks] }));
    for (let i = out.length - 1; i >= 0 && total(out) > budget; i--) {
      out[i] = { ...out[i], blocks: out[i].blocks.filter((b) => !(b.kind === "text" && b.dim)) };
    }
    const rank = (c2) => {
      const k = c2.id ? CARD_PRIORITY.indexOf(c2.id) : -1;
      return k < 0 ? CARD_PRIORITY.length : k;
    };
    while (out.length > 1 && total(out) > budget) {
      let worst = 0;
      out.forEach((c2, i) => {
        if (rank(c2) >= rank(out[worst])) worst = i;
      });
      out.splice(worst, 1);
    }
    return { cards: out, hidden: Math.max(0, before - total(out)) };
  } catch {
    return { cards, hidden: 0 };
  }
}
function paneRows(estimate, viewportRows) {
  const third = Math.floor((viewportRows && viewportRows > 0 ? viewportRows : 24) / 3);
  const want = Number.isFinite(estimate) ? Math.ceil(estimate) + 1 : PANE_ROWS_MIN;
  return Math.max(PANE_ROWS_MIN, Math.min(want, third));
}
function clipCard(card, layout, rows) {
  try {
    const limit = Math.max(1, Math.floor(rows));
    if (cardRows(card, layout) <= limit) return card;
    const marker = { kind: "text", text: "\u2026", dim: true };
    if (limit === 1 && !layout.boxed) return { ...card, title: `${card.title}\u2026`, subtitle: void 0, chip: void 0, blocks: [] };
    if (layout.boxed && limit < 3) return { ...card, title: `${card.title}\u2026`, subtitle: void 0, blocks: [] };
    const head = { ...card, subtitle: limit >= 3 ? card.subtitle : void 0, blocks: [] };
    const kept = [];
    for (const b of card.blocks) {
      if (cardRows({ ...head, blocks: [...kept, b, marker] }, layout) > limit) break;
      kept.push(b);
    }
    return { ...head, blocks: [...kept, marker] };
  } catch {
    return card;
  }
}

// src/lens/term.tsx
var hex = (hue) => PALETTE[hue];
var STAGE_GLYPH = { done: "\u25CF", active: "\u25C9", pending: "\u25CB" };
function bar(ui, key, r, width, hue, moving) {
  const { Box, Text, Client } = ui;
  if (Client && moving) {
    return /* @__PURE__ */ h(Client, { key, module: "./pulse.js", width, height: 1, props: { kind: "bar", ratio: r, width, color: hex(hue), track: PALETTE.s0, glow: "#ffffff", moving } });
  }
  const { fill, rest } = barParts(r, width);
  return /* @__PURE__ */ h(Box, { key, flexDirection: "row" }, /* @__PURE__ */ h(Text, { color: hex(hue) }, fill), /* @__PURE__ */ h(Text, { color: PALETTE.s0 }, rest.replace(/░/g, "\u2588")));
}
function cells(ui, key, list, max) {
  const { Box, Text, Client } = ui;
  const fit2 = max === void 0 ? { cells: list, more: null } : fitCells(list, max);
  const shown = fit2.cells;
  const inner = fit2.more ? `${key}-c` : key;
  const colors = shown.map((s) => hex(STATE_HUE[s]));
  const glyphs = shown.map((s) => s === "pending" ? "\u25A1" : "\u25A0");
  const active = shown.map((s) => s === "active");
  const boxes = Client && active.some(Boolean) ? /* @__PURE__ */ h(Client, { key: inner, module: "./pulse.js", props: { kind: "cells", colors, active, dim: PALETTE.s1, glyphs } }) : /* @__PURE__ */ h(Box, { key: inner, flexDirection: "row", flexWrap: "wrap" }, shown.map((s, i) => /* @__PURE__ */ h(Text, { key: `${key}-${i}`, color: colors[i] }, `${glyphs[i]} `)));
  if (!fit2.more) return boxes;
  return /* @__PURE__ */ h(Box, { key, flexDirection: "row", flexWrap: "wrap", columnGap: 1 }, boxes, /* @__PURE__ */ h(Text, { dimColor: true }, fit2.more));
}
function spinner(ui, key, hue) {
  const { Text, Client } = ui;
  return Client ? /* @__PURE__ */ h(Client, { key, module: "./pulse.js", width: 1, height: 1, props: { kind: "spin", color: hex(hue) } }) : /* @__PURE__ */ h(Text, { key, color: hex(hue) }, "\u25D0");
}
function block(ui, key, b, inner) {
  const { Box, Text } = ui;
  switch (b.kind) {
    case "bar": {
      const right = b.right ? ` ${b.right}` : "";
      const head = b.label || b.right ? /* @__PURE__ */ h(Box, { key: `${key}-h`, flexDirection: "row", justifyContent: "space-between" }, /* @__PURE__ */ h(Box, { flexGrow: 1, minWidth: 0 }, /* @__PURE__ */ h(Text, { dimColor: true, wrap: "truncate-end" }, b.label ?? "")), /* @__PURE__ */ h(Box, { flexShrink: 0 }, /* @__PURE__ */ h(Text, { bold: true }, right))) : null;
      return /* @__PURE__ */ h(Box, { key, flexDirection: "column" }, head, bar(ui, `${key}-b`, b.ratio, Math.max(4, inner), b.hue, !!b.moving));
    }
    case "cells":
      return cells(ui, key, b.cells, cellsMax(inner));
    case "stages":
      return /* @__PURE__ */ h(Box, { key, flexDirection: "row", flexWrap: "wrap" }, b.stages.map((s, i) => /* @__PURE__ */ h(Box, { key: `${key}-${i}`, flexDirection: "row" }, i > 0 ? /* @__PURE__ */ h(Text, { color: s.state === "pending" ? PALETTE.s1 : hex(b.hue) }, "\u2500") : null, /* @__PURE__ */ h(Text, { color: s.state === "pending" ? PALETTE.s2 : hex(b.hue) }, STAGE_GLYPH[s.state]), /* @__PURE__ */ h(Text, { bold: s.state === "active", color: s.state === "active" ? hex(b.hue) : void 0, dimColor: s.state === "pending" }, ` ${s.name} `))));
    case "row":
      return /* @__PURE__ */ h(Box, { key, flexDirection: "row", columnGap: 1, paddingLeft: b.indent ? 2 : 0 }, /* @__PURE__ */ h(Box, { flexShrink: 0 }, b.spinning ? spinner(ui, `${key}-s`, b.dot) : /* @__PURE__ */ h(Text, { color: hex(b.dot) }, "\u25CF")), b.tag ? /* @__PURE__ */ h(Box, { flexShrink: 0 }, /* @__PURE__ */ h(Text, { color: PALETTE.base, backgroundColor: hex(b.tag.hue), bold: true }, ` ${b.tag.text} `)) : null, /* @__PURE__ */ h(Box, { flexGrow: 1, flexShrink: 1, minWidth: 0 }, /* @__PURE__ */ h(Text, { wrap: "truncate-end", dimColor: b.dim }, b.text)), b.right ? /* @__PURE__ */ h(Box, { flexShrink: 0 }, /* @__PURE__ */ h(Text, { dimColor: true }, b.right)) : null);
    case "text":
      return /* @__PURE__ */ h(Text, { key, color: b.hue ? hex(b.hue) : void 0, dimColor: b.dim, wrap: "truncate-end" }, b.text);
    case "chips":
      return /* @__PURE__ */ h(Box, { key, flexDirection: "row", flexWrap: "wrap", columnGap: 1 }, b.chips.map((c2, i) => /* @__PURE__ */ h(Text, { key: `${key}-${i}`, color: hex(c2.hue), bold: true }, `\u2039${c2.text}\u203A`)));
  }
}
function termCard(ui, key, card, layout) {
  const { Box, Text } = ui;
  const inner = innerWidth(layout);
  const head = /* @__PURE__ */ h(Box, { flexDirection: "row", columnGap: 1 }, /* @__PURE__ */ h(Box, { flexShrink: 0 }, /* @__PURE__ */ h(Text, { color: hex(card.hue), bold: true }, card.icon)), /* @__PURE__ */ h(Box, { flexGrow: 1, flexShrink: 1, minWidth: 0 }, layout.boxed ? /* @__PURE__ */ h(Text, { bold: true, wrap: "truncate-end" }, card.title) : /* @__PURE__ */ h(Text, { bold: true, color: hex(card.hue), wrap: "truncate-end" }, card.title)), card.chip ? /* @__PURE__ */ h(Box, { flexShrink: 0 }, /* @__PURE__ */ h(Text, { color: PALETTE.base, backgroundColor: hex(card.chip.hue), bold: true }, ` ${card.chip.text} `)) : null);
  const body = [
    ...card.subtitle ? [/* @__PURE__ */ h(Text, { key: `${key}-sub`, dimColor: true, wrap: "truncate-end" }, card.subtitle)] : [],
    ...card.blocks.map((b, i) => block(ui, `${key}-${i}`, b, inner))
  ];
  if (layout.boxed) {
    return /* @__PURE__ */ h(Box, { key, flexDirection: "column", borderStyle: "round", borderColor: hex(card.hue), paddingX: 1 }, head, body);
  }
  return /* @__PURE__ */ h(Box, { key, flexDirection: "column" }, head, /* @__PURE__ */ h(Box, { flexDirection: "column", paddingLeft: 2 }, body));
}
function partsLine(ui, parts, base) {
  const { Text } = ui;
  return /* @__PURE__ */ h(Text, { wrap: "truncate-end" }, parts.map((p, i) => {
    const text2 = `${i ? p.glue ?? SEP : ""}${p.text}`;
    if (p.hue === "dim") return /* @__PURE__ */ h(Text, { key: `part-${p.key}`, dimColor: true }, text2);
    if (p.hue === "accent") return /* @__PURE__ */ h(Text, { key: `part-${p.key}`, bold: true, color: hex(base) }, text2);
    if (p.hue === "warn") return /* @__PURE__ */ h(Text, { key: `part-${p.key}`, color: PALETTE.yellow }, text2);
    if (p.hue === "alert") return /* @__PURE__ */ h(Text, { key: `part-${p.key}`, color: PALETTE.red }, text2);
    return text2;
  }));
}
function termBand(ui, o) {
  const { Box, Text } = ui;
  return /* @__PURE__ */ h(Box, { flexDirection: "row", columnGap: 1, flexShrink: 1, minWidth: 0 }, /* @__PURE__ */ h(Box, { flexShrink: 0 }, o.spin ? spinner(ui, "band-spin", o.hue) : /* @__PURE__ */ h(Text, { color: hex(o.hue) }, o.icon)), /* @__PURE__ */ h(Box, { key: "band-line", flexShrink: 1, minWidth: 0 }, partsLine(ui, o.parts, o.hue)), o.bar ? /* @__PURE__ */ h(Box, { flexShrink: 0 }, bar(ui, "band-bar", o.bar.ratio, o.bar.width, o.hue, o.bar.moving)) : null, o.cells.length ? /* @__PURE__ */ h(Box, { flexShrink: 0 }, cells(ui, "band-cells", o.cells)) : null);
}

// src/lens/lens-band.ts
var VALIDATING2 = /* @__PURE__ */ new Set(["prep", "review-prep", "validate"]);
var AGENTS_NAMED = 3;
var AGENT_TEXT = 24;
function ownInProgress(m) {
  return (m?.activities ?? []).filter((a) => a.kind === "forge" && a.owner === "own" && !a.done && !a.stopped && a.task !== null);
}
function activityTag(a) {
  const doing = a.job ? VALIDATING2.has(a.job.name) ? "val" : a.job.name === "integrate" ? "int" : a.job.name : a.stage ? STAGE_SHORT[a.stage] ?? a.stage : null;
  return [a.task, doing, a.round ? `r${a.round}` : null].filter(Boolean).join(" ");
}
function bandSubject(m, live = {}) {
  const set2 = (xs, sep) => [...new Set(xs)].sort().join(sep);
  const agents = () => `agents:${set2(live.agents ?? (m?.subagents ?? []).map((s) => s.id), " ")}`;
  const acts = ownInProgress(m);
  if (acts.length >= 2) return `tasks:${set2(acts.map((a) => a.key), " ")}`;
  const head = m ? headline(m) : null;
  if (!head) return agents();
  if (m?.execution?.active) return `run:${m.execution.runId}`;
  if (head.section === "todos") return `todos:${live.todos ? set2(live.todos, "\n") : String(m?.todos?.total ?? 0)}`;
  if (head.section === "agents") return agents();
  return `${head.section}:${head.title}`;
}
function lensBand(m, t, agentsHeard) {
  const acts = ownInProgress(m);
  const head = m ? headline(m) : null;
  const agents = m ? m.subagents.length : agentsHeard;
  const parts = [];
  let section = head?.section ?? "agents";
  let cells2 = head?.cells ?? null;
  if (acts.length >= 2) {
    section = "forge";
    cells2 = null;
    for (const a of acts) parts.push({ key: `slot:${a.key}`, text: activityTag(a), prio: 4 });
  } else {
    const title = head?.title || (section === "agents" ? t.sSubagents : t.sNow);
    parts.push({ key: "title", text: title, title, prio: 4 });
    if (cells2?.total) parts.push({ key: "count", text: `${cells2.done}/${cells2.total}`, prio: 5, hue: "accent" });
    if (head?.detail) parts.push({ key: "detail", text: head.detail, prio: 6, hue: "dim" });
  }
  if (agents > 0) parts.push({ key: "agents", text: `\u25CE ${agents}`, prio: 5, hue: "accent" });
  const adhoc = (m?.activities ?? []).find((a) => a.kind === "adhoc")?.agents ?? [];
  for (const g of adhoc.slice(0, AGENTS_NAMED)) {
    parts.push({ key: `agent:${g.id}`, text: clipWidth((g.description || g.type || "?").replace(/\s+/g, " ").trim(), AGENT_TEXT), prio: 6, hue: "dim" });
  }
  const spent = m ? usageBandText(m) : null;
  if (spent) parts.push({ key: "spend", text: spent, prio: 7, hue: "dim" });
  return { parts, section, cells: cells2?.cells ?? [], ratio: cells2 ? ratio(cells2.done, cells2.total) : 0, spin: agents > 0 };
}

// src/lens/photo.ts
var PHOTOS_MAX = 20;
var STAMP = /^lens · \d{2}:\d{2}:\d{2} #(\d{1,6}) · /;
function clockText(nowMs2) {
  const d = new Date(nowMs2);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n2) => String(n2).padStart(2, "0")).join(":");
}
function photoText(n2, nowMs2, summary2) {
  return `lens \xB7 ${clockText(nowMs2)} #${n2} \xB7 ${summary2}`;
}
function photoId(text2) {
  const m = typeof text2 === "string" ? STAMP.exec(text2) : null;
  return m ? Number(m[1]) : null;
}
function keepPhoto(photos2, n2, shot) {
  photos2.set(n2, shot);
  while (photos2.size > PHOTOS_MAX) {
    const oldest = photos2.keys().next();
    if (oldest.done) break;
    photos2.delete(oldest.value);
  }
}
function lensMode(args, presentation) {
  const a = String(args ?? "").trim().toLowerCase();
  if (a === "live" || a === "pane") return "pane";
  if (a === "foto" || a === "photo") return "photo";
  const columns = Number(presentation?.columns);
  const docks = presentation?.isFullscreen !== false && (Number.isFinite(columns) && columns > 0 ? columns : DOCK_MIN_COLUMNS) >= DOCK_MIN_COLUMNS;
  return docks ? "pane" : "photo";
}

// src/lens/surfaces.ts
var STATUS_COLUMNS = 100;
var RUN_NOTIFY_AFTER_S = 20 * 60;
var VALIDATING3 = /* @__PURE__ */ new Set(["prep", "review-prep", "validate"]);
function activityText(a, t) {
  const doing = a.job ? VALIDATING3.has(a.job.name) ? t.validating : a.job.name === "integrate" ? t.integrating : a.job.name : a.stage ? t.stage[a.stage] ?? a.stage : null;
  return [a.task, doing, a.round ? `r${a.round}` : null].filter(Boolean).join(" ");
}
function ownActive(m, role) {
  return !!m && (ownInProgress(m).length > 0 || role === "owner" && m.execution?.active === true);
}
function ownBusy(m, role) {
  return !!m && (ownInProgress(m).some((a) => !a.idle || a.job !== null || a.agents.length > 0) || role === "owner" && m.execution?.active === true);
}
function statusText(m, t, role) {
  if (!m || !ownActive(m, role)) return null;
  const parts = [{ key: "head", text: "lens", prio: 9 }];
  for (const a of ownInProgress(m)) parts.push({ key: `slot:${a.key}`, text: activityText(a, t), short: activityTag(a), prio: 4 });
  const run = role === "owner" && m.execution?.active ? m.execution : null;
  if (run) parts.push({ key: "run", text: `\u25BA ${run.integrated}/${run.total} ${t.integratedN}`, short: `\u25BA ${run.integrated}/${run.total}`, prio: 5 });
  if (m.subagents.length) parts.push({ key: "agents", text: t.subagentsN(m.subagents.length), short: `\u25CE ${m.subagents.length}`, prio: 6 });
  if (m.usage) parts.push({ key: "cost", text: fmtUsd((m.usage.session ?? m.usage).costUsd, m.locale), prio: 7 });
  return joinParts(fitParts(parts, STATUS_COLUMNS).shown);
}
function spinnerText(m, t) {
  const acts = ownInProgress(m);
  const a = acts.find((x) => x.expanded) ?? acts[0];
  if (!a?.task) return null;
  const rest = activityText({ ...a, task: null }, t);
  return rest ? `${a.task} \xB7 ${rest}` : a.task;
}
function modeLabels(m) {
  if (!m) return [];
  const out = [];
  if (ownInProgress(m).some((a) => a.autonomy === "auto")) out.push("forge auto");
  const inf = m.infinite;
  if (inf?.active) out.push(`\u221E ${inf.cycle}${inf.cyclesMax !== null ? `/${inf.cyclesMax}` : ""}`);
  return out;
}
var counts = (f) => f ? [`${f.critical} C`, `${f.important} I`, ...f.minor > 0 ? [`${f.minor} m`] : []].join(" \xB7 ") : "";
function surfaceEvents(prev, next, role, t) {
  if (!prev) return { toasts: [], ended: null };
  const toasts = [];
  const before = new Map(prev.activities.map((a) => [a.key, a]));
  for (const a of next.activities) {
    if (a.kind !== "forge" || a.owner !== "own" || !a.task) continue;
    const b = before.get(a.key);
    if (!b) continue;
    const v = a.verdict;
    if (v && (!b.verdict || b.verdict.action !== v.action || (b.verdict.round ?? null) !== (v.round ?? null))) {
      toasts.push(v.action === "accept" ? t.toastAccepted(a.task, v.round ?? a.round ?? null) : t.toastVerdict(a.task, v.action, counts(v.findings)));
    }
    if (a.round !== null && a.round >= 2 && a.round !== b.round) toasts.push(t.toastRound(a.task, a.round));
  }
  const x = next.execution;
  const y = prev.execution;
  const same = role === "owner" && !!x && !!y && x.runId === y.runId;
  if (same && x.integrated > y.integrated) {
    const seen = new Set((y.finished ?? []).map((f) => f.task));
    const task = (x.finished ?? []).find((f) => !seen.has(f.task))?.task;
    if (task) toasts.push(t.toastIntegrated(task, x.integrated, x.total));
  }
  let ended = null;
  if (same && y.active && !x.active && (x.elapsedSeconds ?? 0) >= RUN_NOTIFY_AFTER_S) {
    const done = x.total > 0 && x.integrated >= x.total;
    ended = { runId: x.runId, text: done ? t.runFinished(x.integrated, x.total) : t.runStopped(x.stallReason ?? x.stopReason ?? "") };
  }
  return { toasts, ended };
}

// src/lens/usage-file.ts
var USAGE_FILE_MAX = 256 * 1024;
var USAGE_FILES_MAX = 200;
var USAGE_LOOPS_MAX = 201;
function totalsOf(loops) {
  let costUsd = 0;
  let tokens = 0;
  for (const l of Object.values(loops)) {
    costUsd += l.costUsd;
    tokens += l.input + l.output + l.cacheRead + l.cacheWrite;
  }
  return { costUsd, tokens };
}
var isObj4 = (x) => !!x && typeof x === "object" && !Array.isArray(x);
var num2 = (x) => typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : 0;
var str5 = (x) => typeof x === "string" && x ? x : null;
var iso2 = (x) => typeof x === "string" && !Number.isNaN(Date.parse(x)) ? x : null;
function toUsageFile(s, meta) {
  return {
    v: 1,
    session: meta.session,
    label: meta.label,
    worktree: meta.worktree,
    startedAt: new Date(s.startedAt).toISOString(),
    updatedAt: new Date(meta.now).toISOString(),
    costUsd: meta.costUsd,
    loops: s.loops,
    tracking: { waypoint: s.tracking.waypoint, forge: s.tracking.forge },
    activeMs: s.activeMs,
    trackingReread: s.tracking.reread,
    ...meta.runKey !== void 0 ? { runKey: meta.runKey } : {},
    runBaseline: meta.runBaseline ?? null
  };
}
function parseLoop(x) {
  if (!isObj4(x)) return null;
  return {
    kind: str5(x.kind) ?? "unknown",
    description: str5(x.description),
    model: str5(x.model),
    effort: str5(x.effort),
    steps: num2(x.steps),
    input: num2(x.input),
    output: num2(x.output),
    cacheRead: num2(x.cacheRead),
    cacheWrite: num2(x.cacheWrite),
    costUsd: num2(x.costUsd),
    unpriced: num2(x.unpriced)
  };
}
function baselineOf(x) {
  if (!isObj4(x) || !isSafeId(x.runKey)) return null;
  const amount = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
  const costUsd = amount(x.costUsd), tokens = amount(x.tokens), activeMs = amount(x.activeMs);
  return costUsd !== null && tokens !== null && activeMs !== null ? { runKey: x.runKey, costUsd, tokens, activeMs } : null;
}
function parseUsageFile(text2) {
  if (typeof text2 !== "string" || text2.length > USAGE_FILE_MAX) return null;
  let x;
  try {
    x = JSON.parse(text2);
  } catch {
    return null;
  }
  if (!isObj4(x) || x.v !== 1) return null;
  const session = str5(x.session);
  const startedAt = iso2(x.startedAt);
  const updatedAt = iso2(x.updatedAt);
  if (!session || !startedAt || !updatedAt || !isObj4(x.loops)) return null;
  const loops = {};
  for (const [id2, l] of Object.entries(x.loops).slice(0, USAGE_LOOPS_MAX)) {
    const p = parseLoop(l);
    if (p) loops[id2] = p;
  }
  const t = isObj4(x.tracking) ? x.tracking : {};
  return {
    v: 1,
    session,
    label: str5(x.label) ?? session,
    worktree: str5(x.worktree) ?? "",
    startedAt,
    updatedAt,
    costUsd: typeof x.costUsd === "number" && Number.isFinite(x.costUsd) ? x.costUsd : null,
    loops,
    tracking: { waypoint: num2(t.waypoint), forge: num2(t.forge) },
    ..."runKey" in x ? { runKey: isSafeId(x.runKey) ? x.runKey : null } : {},
    ..."runBaseline" in x ? { runBaseline: baselineOf(x.runBaseline) } : {},
    ...typeof x.activeMs === "number" && Number.isFinite(x.activeMs) && x.activeMs >= 0 ? { activeMs: x.activeMs } : {},
    ...typeof x.trackingReread === "number" && Number.isFinite(x.trackingReread) && x.trackingReread >= 0 ? { trackingReread: x.trackingReread } : {}
  };
}
var RUN_RECENT_MS = 12 * 36e5;
var parsed2 = (text2) => {
  if (!text2) return null;
  try {
    const x = JSON.parse(text2);
    return isObj4(x) ? x : null;
  } catch {
    return null;
  }
};
var startOf = (x) => {
  const t = x ? Date.parse(String(x.startedAt)) : NaN;
  return Number.isFinite(t) ? t : null;
};
var recent = (src, now) => src.mtimeMs !== null && Number.isFinite(now) && now - src.mtimeMs <= RUN_RECENT_MS;
function runStartedAt(src, now) {
  for (const s of [src.execution, src.run]) {
    if (!s) continue;
    const x = parsed2(s.text);
    if (!x || x.active !== true && !recent(s, now)) continue;
    const t = startOf(x);
    if (t !== null) return t;
  }
  const large = src.largeRuns.filter((s) => recent(s, now)).map((s) => startOf(parsed2(s.text))).filter((t) => t !== null);
  return large.length ? Math.max(...large) : null;
}
function mergeForRun(files, own, since, runKey = null) {
  const out = newUsage(since);
  const add = (session, loops, tracking, reread, activeMs, baseline) => {
    const t = baseline ? totalsOf(loops) : null;
    const ok = !!baseline && !!t && baseline.costUsd <= t.costUsd + 1e-9 && baseline.tokens <= t.tokens && (activeMs === void 0 || baseline.activeMs <= activeMs);
    const cf = ok && t.costUsd > 0 ? Math.max(0, 1 - baseline.costUsd / t.costUsd) : 1;
    const tf = ok && t.tokens > 0 ? 1 - baseline.tokens / t.tokens : 1;
    for (const [id2, l] of Object.entries(loops)) {
      out.loops[`${session}/${id2}`] = { ...l, input: l.input * tf, output: l.output * tf, cacheRead: l.cacheRead * tf, cacheWrite: l.cacheWrite * tf, costUsd: l.costUsd * cf };
    }
    out.tracking.waypoint += tracking.waypoint * tf;
    out.tracking.forge += tracking.forge * tf;
    out.tracking.reread += reread * tf;
    if (activeMs === void 0) out.activePartial = true;
    else out.activeMs += Math.max(0, activeMs - (ok ? baseline.activeMs : 0));
    return ok;
  };
  for (const f of files) {
    if (f.session === own.session || Date.parse(f.updatedAt) < since) continue;
    if (runKey !== null && f.runKey !== void 0 && f.runKey !== runKey) continue;
    const baseline = runKey !== null && f.runKey === runKey && f.runBaseline?.runKey === runKey ? f.runBaseline : null;
    const ok = add(f.session, f.loops, f.tracking, f.trackingReread ?? 0, f.activeMs, baseline);
    if (runKey !== null && !ok) out.runPartial = true;
  }
  const ownBaseline = runKey !== null && own.baseline?.runKey === runKey ? own.baseline : null;
  const ownOk = add(own.session, own.state.loops, own.state.tracking, own.state.tracking.reread, own.state.activeMs, ownBaseline);
  if (runKey !== null && !ownOk) out.runPartial = true;
  return out;
}
function seedUsage(s, file) {
  for (const [id2, l] of Object.entries(file.loops)) {
    const cur = s.loops[id2];
    if (!cur) {
      s.loops[id2] = { ...l };
      continue;
    }
    if (cur.kind === "unknown") cur.kind = l.kind;
    cur.description ??= l.description;
    cur.model ??= l.model;
    cur.effort ??= l.effort;
    cur.steps += l.steps;
    cur.input += l.input;
    cur.output += l.output;
    cur.cacheRead += l.cacheRead;
    cur.cacheWrite += l.cacheWrite;
    cur.costUsd += l.costUsd;
    cur.unpriced += l.unpriced;
  }
  s.tracking.waypoint += file.tracking.waypoint;
  s.tracking.forge += file.tracking.forge;
  s.tracking.reread += file.trackingReread ?? 0;
  s.activeMs += file.activeMs ?? 0;
}

// src/lens/links.ts
var LINKS_MAX = 100;
var DONE_LINK_MS = 5 * 6e4;
var WORKFLOW_DONE_MS = 15 * 6e4;
var WORKFLOW_AGENT_TTL_MS = 2 * 36e5;
var PROMPT_SCAN = 8192;
var OWN_TASKS_MAX = 100;
var LIST_GRACE_MS = 15e3;
var PARENT_DEPTH2 = 5;
var CONTRACT = /^forge-task:[ \t]*([A-Za-z0-9._-]{1,120}?)(?:-(\d{1,4}))?(?:[ \t]+@([A-Za-z0-9._-]{1,120}))?[ \t]*$/m;
var TASK_ID = /^[ \t]*Task id:[ \t]*([A-Za-z0-9._-]{1,120}?)(?:-(\d{1,4}))?[ \t]*$/mi;
var WORK = /\.forge\/work\/([A-Za-z0-9._-]{1,120})(?:\/([A-Za-z0-9._-]{1,120}))?(?:\/([A-Za-z0-9._-]{1,120}))?/;
var ARTIFACT = /^(?:reviews-\d|evidence$|shadow$)|\.(?:md|txt|json|patch)$/;
var BRIEF_FILE = /^brief-(\d{1,4})\.md$/;
var NOT_TASKS = /* @__PURE__ */ new Set(["run", "infinite"]);
var LIVE = /* @__PURE__ */ new Set(["running", "pending", "waiting", "idle"]);
function pick(t, n2, known) {
  const full = n2 !== void 0 ? `${t}-${n2}` : t;
  if (n2 !== void 0 && known.has(full)) return isSafeId(full) ? { task: full, brief: null } : null;
  return isSafeId(t) ? { task: t, brief: n2 !== void 0 ? Number(n2) : null } : null;
}
function workPath(text2) {
  const m = WORK.exec(text2);
  if (!m) return null;
  const [, a, b, c2] = m;
  if (NOT_TASKS.has(a)) return null;
  const nested = b !== void 0 && !ARTIFACT.test(b);
  const project = nested ? a : null;
  const task = nested ? b : a;
  const file = nested ? c2 : b;
  if (!isSafeId(task) || project !== null && !isSafeId(project)) return null;
  const n2 = file !== void 0 ? BRIEF_FILE.exec(file)?.[1] : void 0;
  return { task, brief: n2 !== void 0 ? Number(n2) : null, project };
}
function taskOfPrompt(prompt, description, known) {
  const text2 = (typeof prompt === "string" ? prompt : "").slice(0, PROMPT_SCAN).replace(/\r\n?/g, "\n");
  const c2 = CONTRACT.exec(text2);
  if (c2 && (c2[3] === void 0 || isSafeId(c2[3]))) {
    const r = pick(c2[1], c2[2], known);
    if (r) return { ...r, project: c2[3] ?? null, via: "contract" };
  }
  const t = TASK_ID.exec(text2);
  if (t) {
    const r = pick(t[1], t[2], known);
    if (r) return { ...r, project: null, via: "task-id" };
  }
  const w = workPath(text2.replace(/\\/g, "/"));
  if (w) return { ...w, via: "work-path" };
  const words = (typeof description === "string" ? description : "").slice(0, 240).split(/[\s:·,;()[\]]+/);
  const word = words.find((x) => x && known.has(x) && isSafeId(x));
  return word ? { task: word, brief: null, project: null, via: "description" } : null;
}
function parentTask(links2, parentId) {
  let id2 = parentId;
  for (let depth = 0; id2 && depth < PARENT_DEPTH2; depth++) {
    const p = links2.find((l) => l.id === id2);
    if (!p) return null;
    if (p.task) return { task: p.task, brief: p.brief, project: p.project };
    id2 = p.parentId;
  }
  return null;
}
function capped(list) {
  if (list.length <= LINKS_MAX) return list;
  const order = [
    ...list.filter((l) => l.status === "done").sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0)),
    ...[...list].sort((a, b) => a.since - b.since)
  ];
  const drop = /* @__PURE__ */ new Set();
  for (const l of order) {
    if (list.length - drop.size <= LINKS_MAX) break;
    drop.add(l.id);
  }
  return list.filter((l) => !drop.has(l.id));
}
function linkSpawn(links2, s, known) {
  if (!s.id) return [...links2];
  const own = taskOfPrompt(s.prompt, s.description, known);
  const up = own ? null : parentTask(links2, s.parentId);
  const link = {
    id: s.id,
    type: cleanText(String(s.type ?? "")),
    description: cleanText(String(s.description ?? "")),
    since: s.now,
    task: own?.task ?? up?.task ?? null,
    brief: own?.brief ?? up?.brief ?? null,
    project: own?.project ?? up?.project ?? null,
    via: own?.via ?? (up ? "parent" : null),
    parentId: s.parentId,
    workflow: s.workflow,
    status: "running",
    tool: null,
    endedAt: null
  };
  return capped([...links2.filter((l) => l.id !== s.id), link]);
}
var statusOf2 = (s) => s === "idle" ? "idle" : s === "waiting" ? "waiting" : s === "running" || s === "pending" ? "running" : "done";
function syncListed(links2, list, now, known) {
  const listed = new Map(list.map((a) => [a.id, a]));
  const out = links2.map((l) => {
    const a = listed.get(l.id);
    if (a) {
      const status = statusOf2(a.status);
      return { ...l, status, parentId: a.parentId ?? l.parentId, endedAt: status === "done" ? l.endedAt ?? now : null, ...status === "done" ? { tool: null } : {} };
    }
    return l.workflow || l.status === "done" || now - l.since <= LIST_GRACE_MS ? l : { ...l, status: "done", tool: null, endedAt: now };
  });
  for (const a of list) {
    if (links2.some((l) => l.id === a.id) || !LIVE.has(a.status)) continue;
    const own = taskOfPrompt("", a.description, known);
    const up = own ? null : parentTask(out, a.parentId);
    out.push({
      id: a.id,
      type: cleanText(String(a.type ?? "")),
      description: cleanText(String(a.description ?? "")),
      since: now,
      task: own?.task ?? up?.task ?? null,
      brief: own?.brief ?? up?.brief ?? null,
      project: own?.project ?? up?.project ?? null,
      via: own?.via ?? (up ? "parent" : null),
      parentId: a.parentId,
      workflow: null,
      status: statusOf2(a.status),
      tool: null,
      endedAt: null
    });
  }
  return capped(out);
}
function endAgent(links2, id2, now, opts = {}) {
  return links2.map((l) => l.id === id2 && l.status !== "done" && (l.workflow || opts.any) ? { ...l, status: "done", tool: null, endedAt: now } : l);
}
function setTool(links2, id2, tool) {
  return links2.map((l) => l.id === id2 ? { ...l, tool: tool ? { name: cleanText(String(tool.name ?? "")), since: tool.since } : null } : l);
}
function endTool(links2, id2, name) {
  const shown = cleanText(String(name ?? ""));
  return links2.map((l) => l.id === id2 && l.tool?.name === shown ? { ...l, tool: null } : l);
}
function pruneLinks(links2, now) {
  return links2.flatMap((l) => {
    if (l.workflow && l.status !== "done" && now - l.since > WORKFLOW_AGENT_TTL_MS) return [{ ...l, status: "done", tool: null, endedAt: now }];
    if (l.status === "done" && l.endedAt !== null && now - l.endedAt > (l.workflow ? WORKFLOW_DONE_MS : DONE_LINK_MS)) return [];
    return [l];
  });
}
var OWN_TASK = /forge\.cjs\b[^\n]*?(?:--task[ \t]+|swarm[ \t]+task[ \t]+)["']?([A-Za-z0-9._-]{1,120})/;
function ownTaskOf(command) {
  if (typeof command !== "string") return null;
  const m = OWN_TASK.exec(command.slice(0, PROMPT_SCAN));
  return m && isSafeId(m[1]) ? m[1] : null;
}
function addOwnTask(list, id2) {
  if (!id2) return [...list];
  return [...list.filter((t) => t !== id2), id2].slice(-OWN_TASKS_MAX);
}
function knownTasks(m) {
  const out = /* @__PURE__ */ new Set();
  for (const a of m?.activities ?? []) if (a.kind === "forge" && a.task) out.add(a.task);
  for (const s of m?.execution?.slots ?? []) out.add(s.task);
  return out;
}

// src/lens/register.tsx
var panel = atom({ plugin: "lens", key: "panel" }, null);
var hidden = atom({ plugin: "lens", key: "hidden" }, false);
var waypointDrawn = atom({ plugin: "waypoint", key: "drawn" }, null);
var waypointHidden = atom({ plugin: "waypoint", key: "hidden" }, false);
var PANE = "lens";
var LINE_MAX = 80;
var MAX_ACTIVITY = 50;
var SUBAGENT_TTL_MS = 36e5;
var PANEL_EVERY_MS = 1e4;
var WRITE_GAP_MS = 1e3;
var PLAN_FALLBACK_AGE_MS = 24 * 36e5;
var FORGE_STATUS_MAX = 64 * 1024;
var MAX_PROPOSAL_FILES = 50;
var STATUS_AGE_MS = 24 * 36e5;
var BRIEF_LISTINGS_MAX = 5;
var JOBS_MAX = 10;
var timer = null;
var emptyActivity = () => ({ tool: null, turnSince: null, todos: void 0, subagents: [], ccTasks: [] });
var activity = emptyActivity();
var finished = [];
var turnClock = newTurnClock();
var syncTurn = () => {
  activity.turnSince = turnClock.since;
};
async function touch($) {
  try {
    touchTurn(turnClock, await nowMs($));
  } catch {
  }
}
var tools = /* @__PURE__ */ new Map();
var MAX_TODOS = 200;
var links = [];
var ownTasks = [];
var wakeAt = null;
var WAKE_MIN_S = 60;
var WAKE_MAX_S = 3600;
var agentTools = /* @__PURE__ */ new Map();
var pendingEnds = /* @__PURE__ */ new Map();
var PENDING_END_MS = 2 * 6e4;
var PENDING_ENDS_MAX = 50;
var busy = false;
var roadmap = noneBand();
var bandRead = false;
var bandModel = null;
var bandJson = "";
var NO_VIEW = { columns: null, rows: null, fullscreen: null, maxRows: null, body: null, docked: false };
var views = /* @__PURE__ */ new Map();
var viewOf = (surface) => views.get(String(surface)) ?? NO_VIEW;
var focusAgent = null;
var viewNumber = (v) => typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
function noteView(surface, viewport, more = {}) {
  const was = viewOf(surface);
  views.set(String(surface), {
    columns: viewNumber(viewport?.columns) ?? was.columns,
    rows: viewNumber(viewport?.rows) ?? was.rows,
    fullscreen: typeof viewport?.isFullscreen === "boolean" ? viewport.isFullscreen : was.fullscreen,
    maxRows: viewNumber(more.maxRows) ?? was.maxRows,
    body: viewNumber(more.body) ?? was.body,
    docked: more.docked ?? was.docked
  });
}
var BAND_MARK_COLUMNS = 5;
function transcriptColumns(surface, viewport) {
  const screen = viewNumber(viewport?.columns) ?? LINE_MAX;
  const v = viewOf(surface);
  if (v.body !== null && v.columns === screen) return Math.min(screen, v.body + BAND_MARK_COLUMNS);
  if (paneUp && v.docked) return Math.max(1, screen - DOCK_COLUMNS);
  return screen;
}
function noteRender($, surface, viewport, more = {}) {
  const before = transcriptColumns(surface, viewport);
  noteView(surface, viewport, more);
  if (photos.size && transcriptColumns(surface, viewport) !== before) $.ui.invalidate("ui.render");
}
var ICON_COLUMNS = 2;
var BAR_MIN = 6;
var BAR_MAX = 36;
var BAND_CELLS = 16;
var waypointSeen = false;
var takeoverAt = Number.NEGATIVE_INFINITY;
var TAKEOVER_MS = 5e3;
var hiddenSubject = null;
async function closeBand($, subject) {
  try {
    if (await nowMs($) - takeoverAt < TAKEOVER_MS) return;
    hiddenSubject = subject;
    await update($, hidden, () => true);
  } catch {
  }
}
function subjectOf(model) {
  const todos = Array.isArray(activity.todos) ? activity.todos.map((t) => String(t?.content ?? "")) : [];
  return bandSubject(model, { todos, agents: activity.subagents.map((s) => s.id) });
}
async function bandUp($) {
  if (!busy || await waypointDraws($)) return false;
  return !(await read($, hidden) && hiddenSubject === subjectOf(bandModel));
}
async function releaseBand($, model) {
  if (hiddenSubject !== null && hiddenSubject === subjectOf(model)) return;
  hiddenSubject = null;
  try {
    if (await read($, hidden)) await update($, hidden, () => false);
  } catch {
  }
}
function runLens($, args) {
  $.command.run({ command: "lens", args }).catch(async () => {
    try {
      await $.prompt.fill({ text: `/lens ${args}`, mode: "replace" });
      $.ui.toast(lensTexts().pressEnter);
    } catch {
    }
  });
}
var SAFE_TASK2 = /^(?!\.{1,2}$)[A-Za-z0-9._-]{1,120}$/;
var panelFiles = {};
var paneUp = false;
var panelTimer = null;
var panelRefreshing = false;
var writeTimer = null;
var writing = false;
var dirty = false;
var lastWrite = -Infinity;
var lastJson = "";
function resetPanel() {
  activity = emptyActivity();
  finished = [];
  turnClock.since = null;
  turnClock.lastActivityMs = 0;
  tools.clear();
  busy = false;
  panelFiles = {};
  lastJson = "";
  bandModel = null;
  bandJson = "";
  focusAgent = null;
  hiddenSubject = null;
  waypointSeen = false;
  takeoverAt = Number.NEGATIVE_INFINITY;
  prevModel = null;
  primed = false;
  toastQueue = [];
  toastTimer?.cancel();
  toastTimer = null;
  toastPending = false;
  forgeHeardAt = null;
  statusCache.clear();
  jobCache.clear();
  links = [];
  ownTasks = [];
  wakeAt = null;
  agentTools.clear();
  pendingEnds.clear();
}
function showAgentTool(id2) {
  const last = [...agentTools.get(id2)?.values() ?? []].at(-1);
  links = setTool(links, id2, last ?? null);
}
function applyPendingEnd(id2, now) {
  const at = pendingEnds.get(id2);
  if (at === void 0) return;
  pendingEnds.delete(id2);
  if (now - at <= PENDING_END_MS) links = endAgent(links, id2, at);
}
function isBusy(now) {
  activity.subagents = activity.subagents.filter((s) => now - s.since < SUBAGENT_TTL_MS);
  const todos = summarizeTodos(activity.todos);
  return todos.total - todos.done > 0 || activity.subagents.length > 0 || links.some((l) => l.status !== "done") || ownBusy(bandModel, runRoleOf(roadmap)) || forgeHeardAt !== null && now - forgeHeardAt < FORGE_HEARD_MS;
}
var waypointBand = false;
var waypointLoaded = null;
async function checkWaypoint($) {
  try {
    if (await read($, hidden)) return;
  } catch {
  }
  let listed = null;
  try {
    listed = (await $.command.list()).some((c2) => c2.plugin === "waypoint" || c2.name.startsWith("waypoint:"));
  } catch {
    listed = null;
  }
  const loadedChanged = listed !== null && listed !== waypointLoaded;
  if (listed !== null) waypointLoaded = listed;
  const installed = waypointLoaded === true;
  let said = false;
  try {
    said = installed && typeof await read($, waypointDrawn) === "boolean";
  } catch {
  }
  let next = false;
  if (installed && !said) {
    try {
      next = (await loadBandModel($)).mode !== "none";
    } catch {
    }
  }
  if (next !== waypointBand || loadedChanged) {
    waypointBand = next;
    $.ui.invalidate("ui.render");
  }
}
async function waypointDraws($) {
  if (waypointLoaded === false) return waypointBand;
  try {
    const said = await read($, waypointDrawn);
    if (typeof said === "boolean") return said;
  } catch {
  }
  try {
    if (await read($, waypointHidden)) return false;
  } catch {
  }
  return waypointBand;
}
async function noteActivity($) {
  try {
    const now = isBusy(await nowMs($));
    if (now && !busy) await checkWaypoint($);
    if (now === busy) return;
    busy = now;
    $.ui.invalidate("ui.render");
  } catch {
  }
}
async function tick($) {
  const was = busy;
  await noteActivity($);
  if (was && busy) {
    try {
      await checkWaypoint($);
    } catch {
    }
  }
  if (busy && !paneUp) await refreshPanel($);
  if (!paneUp && !busy) await refreshUsage($, false);
}
function showTool() {
  const last = [...tools.values()].at(-1);
  activity.tool = last ? { ...last } : null;
}
async function isPaneOpen($) {
  try {
    return (await $.ui.panes()).some((p) => p.id === PANE);
  } catch {
    return false;
  }
}
function planFile(root, path) {
  const p = path.trim().replace(/\\/g, "/");
  if (!p.toLowerCase().endsWith(".md") || p.startsWith("/") || /^[A-Za-z]:/.test(p) || p.split("/").includes("..")) return null;
  return join(root, p);
}
async function newest2($, paths) {
  let best = null;
  for (const path of paths) {
    const t = await mtime($, path);
    if (t !== null && (!best || t > best.t)) best = { path, t };
  }
  return best;
}
var proposalCache = null;
var forgeSeen = null;
var statusCache = /* @__PURE__ */ new Map();
var jobCache = /* @__PURE__ */ new Map();
async function readCached($, dir, max, size, cache, keep) {
  const files = (await listOpt($, dir)).filter((f) => f.kind === "file" && f.name.endsWith(".json") && f.size <= size && keep(f)).sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, max);
  const out = [];
  const names = /* @__PURE__ */ new Set();
  for (const f of files) {
    const path = join(dir, f.name);
    names.add(path);
    const hit = cache.get(path);
    if (hit && hit.size === f.size && hit.mtimeMs === f.mtimeMs) {
      out.push(hit.text);
      continue;
    }
    const text2 = await readOpt($, path);
    if (text2 === void 0) continue;
    cache.set(path, { size: f.size, mtimeMs: f.mtimeMs, text: text2 });
    out.push(text2);
  }
  for (const k of [...cache.keys()]) if (k.startsWith(`${dir}/`) && !names.has(k)) cache.delete(k);
  return out;
}
async function briefNumbers($, folder) {
  return (await listOpt($, folder)).filter((f) => f.kind === "file").map((f) => /^brief-(\d{1,4})\.md$/.exec(f.name)?.[1]).filter(Boolean).map(Number);
}
async function briefsByKey($, statusRoot, texts) {
  const out = {};
  const work = join(statusRoot, ".forge", "work");
  let listings = 0;
  const nums = async (folder) => {
    listings++;
    return briefNumbers($, folder);
  };
  for (const text2 of texts) {
    if (listings >= BRIEF_LISTINGS_MAX) break;
    let st = null;
    try {
      st = normalizeStatus(JSON.parse(text2));
    } catch {
      st = null;
    }
    const key = st ? statusKey(st.task, st.project) : null;
    if (!st || !key || st.doneAt || !SAFE_TASK2.test(st.task)) continue;
    let found = st.project && SAFE_TASK2.test(st.project) ? await nums(join(work, st.project, st.task)) : [];
    if (!found.length && listings < BRIEF_LISTINGS_MAX) found = await nums(join(work, st.task));
    if (found.length) out[key] = Math.max(...found);
  }
  return out;
}
async function readJsonDir2($, dir, max, size, keep = () => true) {
  const out = {};
  const files = (await listOpt($, dir)).filter((f) => f.kind === "file" && f.name.endsWith(".json") && f.size <= size && keep(f.name.slice(0, -5))).sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, max);
  for (const f of files) {
    const text2 = await readOpt($, join(dir, f.name));
    if (text2 !== void 0) out[f.name.slice(0, -5)] = text2;
  }
  return out;
}
async function loadExecutionFiles($, main, listing) {
  const out = {};
  const dir = join(main, ".forge");
  const entries = listing ?? await listOpt($, dir);
  const exec = entries.find((f) => f.kind === "file" && f.name === "execution.json");
  if (!exec || exec.size > FORGE_EXEC_MAX) return out;
  out.forgeExecution = await readOpt($, join(dir, "execution.json"));
  if (out.forgeExecution === void 0) return out;
  if (entries.some((f) => f.kind === "dir" && f.name === "execution")) {
    out.forgeExecTasks = await readJsonDir2($, join(dir, "execution"), FORGE_EXEC_TASKS_MAX, FORGE_EXEC_FILE_MAX, (name) => SAFE_TASK2.test(name));
  }
  if (entries.some((f) => f.kind === "dir" && f.name === "live")) {
    out.forgeLive = await readJsonDir2($, join(dir, "live"), FORGE_LIVE_MAX, FORGE_EXEC_FILE_MAX);
  }
  return out;
}
async function loadForgeFiles($, root, now) {
  if (mainCheckout === null) mainCheckout = mainCheckoutFrom(root, await readOpt($, join(root, ".git")) ?? null);
  const main = mainCheckout;
  const dir = join(root, ".forge");
  const entries = await listOpt($, dir);
  let execFiles = {};
  try {
    execFiles = await loadExecutionFiles($, main, main === root ? entries : void 0);
  } catch {
  }
  const out = { ...execFiles };
  const mainDir = join(main, ".forge");
  const mainEntries = main === root ? entries : await listOpt($, mainDir);
  const decisions = mainEntries.find((f) => f.kind === "file" && f.name === "decisions.json");
  if (decisions && decisions.size <= DECISIONS_MAX) out.forgeDecisions = await readOpt($, join(mainDir, "decisions.json"));
  if (mainEntries.some((f) => f.kind === "dir" && f.name === "jobs")) {
    const jobs = await readCached($, join(mainDir, "jobs"), JOBS_MAX, JOB_FILE_MAX, jobCache, () => true);
    if (jobs.length) out.forgeJobs = jobs;
  } else jobCache.clear();
  const statusRoot = statusRootOf(root, main);
  const statusEntries = statusRoot === root ? entries : mainEntries;
  if (statusEntries.some((f) => f.kind === "dir" && f.name === "status")) {
    out.forgeStatuses = await readCached($, join(statusRoot, ".forge", "status"), FORGE_STATUSES_READ, FORGE_STATUS_MAX, statusCache, (f) => now - f.mtimeMs < STATUS_AGE_MS);
    out.forgeBriefsBy = await briefsByKey($, statusRoot, out.forgeStatuses);
  } else {
    statusCache.clear();
    const status = entries.find((f) => f.kind === "file" && f.name === "status.json");
    if (status && status.size <= FORGE_STATUS_MAX) out.forgeStatus = await readOpt($, join(dir, "status.json"));
    if (out.forgeStatus !== void 0) {
      let st = null;
      try {
        st = normalizeStatus(JSON.parse(out.forgeStatus));
      } catch {
        st = null;
      }
      const task = st?.task;
      if (task && SAFE_TASK2.test(task)) {
        const project = st?.project;
        let nums = project && SAFE_TASK2.test(project) ? await briefNumbers($, join(dir, "work", project, task)) : [];
        if (!nums.length) nums = await briefNumbers($, join(dir, "work", task));
        if (nums.length) out.forgeBriefs = Math.max(...nums);
      }
    }
  }
  if (!entries.length) {
    forgeSeen = { dir, entries };
    return out;
  }
  const run = entries.find((f) => f.kind === "file" && f.name === "run.json");
  if (run && run.size <= FORGE_RUN_MAX) out.forgeRun = await readOpt($, join(dir, "run.json"));
  forgeSeen = { dir, entries, run: out.forgeRun, execution: main === root ? out.forgeExecution : void 0 };
  if (entries.some((f) => f.kind === "dir" && f.name === "proposals")) {
    const pdir = join(dir, "proposals");
    const files = (await listOpt($, pdir)).filter((f) => f.kind === "file" && f.name.endsWith(".json") && PROPOSAL_ID.test(f.name.slice(0, -5))).sort((a, b) => a.name < b.name ? 1 : a.name > b.name ? -1 : 0).slice(0, MAX_PROPOSAL_FILES);
    const key = JSON.stringify([pdir, files.map((f) => [f.name, f.size, f.mtimeMs])]);
    if (proposalCache?.key === key) out.proposals = proposalCache.proposals;
    else {
      const proposals = {};
      let complete = true;
      for (const f of files) {
        const text2 = await readOpt($, join(pdir, f.name));
        if (text2 !== void 0) proposals[f.name.slice(0, -5)] = text2;
        else complete = false;
      }
      proposalCache = complete ? { key, proposals } : null;
      out.proposals = proposals;
    }
  }
  return out;
}
async function loadPanelFiles($, now) {
  const root = await $.session.root();
  let forge = {};
  forgeSeen = null;
  try {
    forge = await loadForgeFiles($, root, now);
  } catch {
  }
  return { ...await loadSuperpowersFiles($, root, now), ...forge };
}
async function loadSuperpowersFiles($, root, now) {
  const out = {};
  const sdd = join(root, ".superpowers", "sdd");
  const ledgers = (await listOpt($, sdd)).filter((d) => d.kind === "dir").slice(0, MAX_DOCS).map((d) => join(sdd, d.name, "progress.md"));
  const ledger = await newest2($, ledgers);
  if (ledger) {
    out.ledger = await readOpt($, ledger.path);
    if (out.ledger !== void 0) out.ledgerMtimeMs = ledger.t;
  }
  if (out.ledger !== void 0) {
    const planPath = parseSddLedger(out.ledger).planPath;
    const file = planPath ? planFile(root, planPath) : null;
    if (file) out.ledgerPlan = await readOpt($, file);
    return out;
  }
  const plans = join(root, "docs", "superpowers", "plans");
  const mds = (await listOpt($, plans)).filter((f) => f.kind === "file" && f.name.endsWith(".md")).slice(0, MAX_DOCS).map((f) => join(plans, f.name));
  const plan = await newest2($, mds);
  if (plan && now - plan.t <= PLAN_FALLBACK_AGE_MS) out.planFallback = await readOpt($, plan.path);
  return out;
}
var USAGE_WRITE_MS = 3e4;
var LARGE_RUNS_MAX = 100;
var LARGE_RUNS_TTL_MS = 6e4;
var SAFE_SESSION = /^[A-Za-z0-9._-]{1,128}$/;
var usage = newUsage(0);
var usageStartedAt = null;
var officialUsd = null;
var lastUsageWrite = 0;
var lastUsageSig = "";
var usageWrite = null;
var sessionId = null;
var mainCheckout = null;
var runInputs = null;
var usageFileCache = /* @__PURE__ */ new Map();
var largeRunsCache = null;
var officialOwnUsd = null;
var seededUsd = 0;
var runBaseline = null;
function runKeyNow() {
  if (!bandRead) return void 0;
  const id2 = roadmap.viewer?.runId;
  return runRoleOf(roadmap) === "owner" && isSafeId(id2) ? id2 : null;
}
function keepRunBaseline() {
  const key = runKeyNow();
  if (key === null || key === void 0 || runBaseline?.runKey === key) return;
  const t = totalsOf(usage.loops);
  runBaseline = { runKey: key, costUsd: t.costUsd, tokens: t.tokens, activeMs: usage.activeMs };
}
var ownCostUsd = () => Object.values(usage.loops).reduce((a, l) => a + l.costUsd, 0);
function resetUsage() {
  usage = newUsage(0);
  usageStartedAt = null;
  officialUsd = null;
  officialOwnUsd = null;
  seededUsd = 0;
  runBaseline = null;
  bandRead = false;
  execSeen = null;
  lastUsageWrite = 0;
  lastUsageSig = "";
  sessionId = null;
  mainCheckout = null;
  runInputs = null;
  usageFileCache.clear();
  largeRunsCache = null;
}
var execSeen = null;
async function watchRun($, main) {
  const path = join(main, ".forge", "execution.json");
  let st = null;
  try {
    st = await $.fs.stat(path);
  } catch {
    st = null;
  }
  const seen = st ? `${st.size}:${st.mtimeMs}` : "";
  if (seen === execSeen) return;
  if (!bandRead) {
    const active = !!st && st.size <= FORGE_EXEC_MAX && parseExecution(await readOpt($, path), await nowMs($))?.active === true;
    if (!active) {
      execSeen = seen;
      return;
    }
  }
  try {
    roadmap = await loadBandModel($);
  } catch {
    return;
  }
  execSeen = seen;
  bandRead = true;
  keepRunBaseline();
}
var endedId = null;
async function sessionIdNow($) {
  const id2 = await $.session.id();
  return id2 === endedId ? null : id2;
}
async function usageWhere($) {
  const root = await $.session.root();
  if (sessionId === null) sessionId = await sessionIdNow($);
  if (sessionId === null) throw new Error("the session id is not known yet");
  if (mainCheckout === null) mainCheckout = mainCheckoutFrom(root, await readOpt($, join(root, ".git")) ?? null);
  return { root, session: sessionId, main: mainCheckout };
}
async function seedFromOwnFile($, startedAt) {
  const target = usage;
  const where = await usageWhere($);
  if (!SAFE_SESSION.test(where.session)) return;
  const file = parseUsageFile(await readOpt($, join(where.main, ".forge", "usage", `${where.session}.json`)));
  if (file && Date.parse(file.startedAt) === startedAt && usage === target && usageStartedAt === startedAt) {
    seedUsage(usage, file);
    seededUsd = Object.values(file.loops).reduce((a, l) => a + l.costUsd, 0);
    if (file.runBaseline) runBaseline = file.runBaseline;
  }
}
async function syncUsageStart($) {
  const u = await $.session.usage();
  if (usageStartedAt !== u.startedAt) {
    const adopt = usageStartedAt === null;
    usageStartedAt = u.startedAt;
    if (adopt) usage.startedAt = u.startedAt;
    else {
      usage = newUsage(u.startedAt);
      seededUsd = 0;
    }
    lastUsageSig = "";
    try {
      await seedFromOwnFile($, u.startedAt);
    } catch {
    }
  }
  takeOfficial(u);
}
function takeOfficial(u) {
  officialUsd = u.cost?.usd ?? null;
  officialOwnUsd = ownCostUsd() - seededUsd;
}
var baseName = (path) => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;
function usageSig() {
  const steps = Object.values(usage.loops).reduce((a, l) => a + l.steps, 0);
  const key = runKeyNow();
  return `${usage.startedAt}|${steps}|${usage.tracking.waypoint}|${usage.tracking.forge}|${usage.activeMs}|${key === void 0 ? "?" : key ?? ""}`;
}
async function writeUsageFileNow($, force, watch) {
  try {
    if (usageStartedAt === null) return;
    const now = await nowMs($);
    if (!force && now - lastUsageWrite < USAGE_WRITE_MS) return;
    if (!Object.values(usage.loops).some((l) => l.steps > 0)) return;
    if (watch || !bandRead) await watchRun($, (await usageWhere($)).main);
    const sig = usageSig();
    if (sig === lastUsageSig) return;
    const where = await usageWhere($);
    if (!SAFE_SESSION.test(where.session)) return;
    const forge = join(where.main, ".forge");
    if (!(await listOpt($, forge)).length) return;
    lastUsageWrite = now;
    const label = roadmap.mode === "work" && roadmap.track ? roadmap.track : baseName(where.root);
    keepRunBaseline();
    const text2 = JSON.stringify(toUsageFile(usage, { session: where.session, label, worktree: where.root, now, costUsd: officialUsd, runKey: runKeyNow(), runBaseline }));
    if (text2.length > USAGE_FILE_MAX) return;
    await $.fs.write(join(forge, "usage", `${where.session}.json`), text2);
    lastUsageSig = sig;
  } catch {
  }
}
async function writeUsageFile($, force, watch = false) {
  while (usageWrite) {
    if (!force) return;
    await usageWrite;
  }
  usageWrite = writeUsageFileNow($, force, watch).finally(() => {
    usageWrite = null;
  });
  await usageWrite;
}
async function largeRuns($, forge, now) {
  const work = join(forge, "work");
  const dirs = (await listOpt($, work)).filter((d) => d.kind === "dir" && SAFE_TASK2.test(d.name)).slice(0, LARGE_RUNS_MAX);
  const key = JSON.stringify(dirs.map((d) => d.name));
  if (largeRunsCache?.key === key && now - largeRunsCache.at < LARGE_RUNS_TTL_MS) return largeRunsCache.runs;
  const runs = [];
  for (const d of dirs) {
    const file = join(work, d.name, "run.json");
    let st;
    try {
      st = await $.fs.stat(file);
    } catch {
      continue;
    }
    const text2 = st.size <= FORGE_RUN_MAX ? await readOpt($, file) : void 0;
    let started = false;
    try {
      started = text2 !== void 0 && Number.isFinite(Date.parse(String(JSON.parse(text2).startedAt)));
    } catch {
    }
    runs.push({ text: started ? text2 : JSON.stringify({ startedAt: new Date(st.mtimeMs).toISOString() }), mtimeMs: st.mtimeMs });
  }
  largeRunsCache = { key, at: now, runs };
  return runs;
}
async function refreshRunInputs($, now) {
  const where = await usageWhere($);
  const forge = join(where.main, ".forge");
  const seen = forgeSeen?.dir === forge ? forgeSeen : null;
  const entries = seen ? seen.entries : await listOpt($, forge);
  if (!entries.length) {
    runInputs = null;
    return;
  }
  const small = async (name, max) => entries.some((f) => f.kind === "file" && f.name === name && f.size <= max) ? readOpt($, join(forge, name)) : void 0;
  const mtimeOf = (name) => entries.find((f) => f.kind === "file" && f.name === name)?.mtimeMs ?? null;
  const since = runStartedAt({
    execution: { text: seen ? seen.execution : await small("execution.json", FORGE_EXEC_MAX), mtimeMs: mtimeOf("execution.json") },
    run: { text: seen ? seen.run : await small("run.json", FORGE_RUN_MAX), mtimeMs: mtimeOf("run.json") },
    largeRuns: entries.some((f) => f.kind === "dir" && f.name === "work") ? await largeRuns($, forge, now) : []
  }, now);
  if (since === null) {
    runInputs = null;
    return;
  }
  const dir = join(forge, "usage");
  const own = `${where.session}.json`;
  const listed = (await listOpt($, dir)).filter((f) => f.kind === "file" && f.name.endsWith(".json") && f.name !== own && f.size <= USAGE_FILE_MAX && !(f.mtimeMs > 0 && f.mtimeMs < since)).sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, USAGE_FILES_MAX);
  const files = [];
  const names = /* @__PURE__ */ new Set();
  for (const f of listed) {
    names.add(f.name);
    const hit = usageFileCache.get(f.name);
    let file;
    if (hit && hit.size === f.size && hit.mtimeMs === f.mtimeMs) file = hit.file;
    else {
      const text2 = await readOpt($, join(dir, f.name));
      file = parseUsageFile(text2);
      if (text2 !== void 0) usageFileCache.set(f.name, { size: f.size, mtimeMs: f.mtimeMs, file });
    }
    if (file) files.push(file);
  }
  for (const name of [...usageFileCache.keys()]) if (!names.has(name)) usageFileCache.delete(name);
  runInputs = { since, files };
}
async function refreshUsage($, withRun) {
  try {
    await syncUsageStart($);
  } catch {
  }
  if (withRun) {
    try {
      await refreshRunInputs($, await nowMs($));
    } catch {
    }
  }
  await writeUsageFile($, false, !withRun);
}
function usageInput() {
  let run = null;
  try {
    if (runInputs && sessionId !== null) run = mergeForRun(runInputs.files, { session: sessionId, state: usage, baseline: runBaseline }, runInputs.since, runKeyNow() ?? null);
  } catch {
  }
  return { session: usage, run, officialUsd, officialOwnUsd };
}
function recordFinished(ran, now) {
  if (!Number.isFinite(ran.since) || !Number.isFinite(now)) return;
  const loop = usage.loops[ran.id];
  const description = ran.description ?? loop?.description;
  finished = pushFinished(freshFinished(finished, now), {
    id: ran.id,
    type: ran.type,
    seconds: Math.max(0, Math.floor((now - ran.since) / 1e3)),
    at: now,
    ...description ? { description: clip3(String(description), LINE_MAX) } : {},
    ...loop?.model ? { model: loop.model } : {}
  });
}
async function agentList($) {
  let list;
  try {
    list = await $.agent.list();
  } catch {
    return null;
  }
  if (!Array.isArray(list)) return null;
  return list.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const a = raw;
    if (typeof a.id !== "string") return [];
    return [{
      id: a.id,
      type: typeof a.type === "string" ? a.type : "",
      description: typeof a.description === "string" ? a.description : "",
      status: typeof a.status === "string" ? a.status : "",
      parentId: typeof a.parentId === "string" ? a.parentId : null
    }];
  });
}
function liveSubagents(now, list) {
  const fresh = activity.subagents.filter((s) => now - s.since < SUBAGENT_TTL_MS);
  if (!list) return fresh;
  const since = new Map(fresh.map((s) => [s.id, s.since]));
  const out = [];
  for (const a of list) {
    if (a.status !== "running" && a.status !== "pending" && a.status !== "waiting" && a.status !== "idle") continue;
    out.push({ id: a.id, type: a.type, ...a.description ? { description: a.description } : {}, status: a.status, since: since.get(a.id) ?? now });
  }
  const live = new Set(out.map((s) => s.id));
  for (const s of fresh) if (!live.has(s.id)) recordFinished(s, now);
  finished = withoutRunning(finished, out);
  return out.slice(-MAX_ACTIVITY);
}
async function buildPanel($) {
  const now = await nowMs($);
  if (sessionId === null) {
    try {
      sessionId = await sessionIdNow($);
    } catch {
    }
  }
  const subagents = activity.subagents.filter((s) => now - s.since < SUBAGENT_TTL_MS);
  return buildPanelModel({
    band: roadmap,
    ...panelFiles,
    activity: { ...activity, subagents, finished: freshFinished(finished, now) },
    now,
    usage: usageInput(),
    sessionId,
    links,
    ownTasks,
    wakeAt,
    focusAgent,
    ...roadmap.locale ? { locale: roadmap.locale } : {}
  });
}
function keepBand($, model) {
  const json2 = bandKey(model);
  if (json2 === bandJson) return;
  bandJson = json2;
  bandModel = model;
  $.ui.invalidate("ui.render");
  void releaseBand($, model);
  void updateSurfaces($, model);
}
function notePane($, up) {
  if (up === paneUp) return;
  paneUp = up;
  if (!up) focusAgent = null;
  if (photos.size) $.ui.invalidate("ui.render");
}
async function writePanel($) {
  if (!paneUp) return;
  try {
    const model = await buildPanel($);
    keepBand($, model);
    const json2 = JSON.stringify(model);
    if (json2 === lastJson) return;
    lastWrite = await nowMs($);
    lastJson = json2;
    await update($, panel, () => model);
  } catch {
  }
}
async function requestPanelWrite($) {
  if (!paneUp) return;
  dirty = true;
  if (writeTimer || writing) return;
  writing = true;
  try {
    const wait = lastWrite + WRITE_GAP_MS - await nowMs($);
    if (wait > 0) {
      writeTimer = $.clock.after(wait, () => {
        writeTimer = null;
        void requestPanelWrite($);
      });
      return;
    }
    dirty = false;
    await writePanel($);
  } catch {
  } finally {
    writing = false;
  }
  if (dirty) await requestPanelWrite($);
}
function startPanelTimer($) {
  if (!panelTimer) panelTimer = $.clock.every(PANEL_EVERY_MS, () => {
    void refreshPanel($);
  });
}
function stopPanelTimer() {
  panelTimer?.cancel();
  panelTimer = null;
}
async function refreshPanel($, force = false) {
  if (panelRefreshing) return;
  panelRefreshing = true;
  try {
    notePane($, await isPaneOpen($));
    if (!paneUp) stopPanelTimer();
    if (!paneUp && !busy && !force) return;
    if (paneUp) startPanelTimer($);
    try {
      roadmap = await loadBandModel($);
      bandRead = true;
    } catch {
    }
    keepRunBaseline();
    const now = await nowMs($);
    if (sessionId === null) {
      try {
        sessionId = await sessionIdNow($);
      } catch {
      }
    }
    panelFiles = await loadPanelFiles($, now);
    const list = await agentList($);
    activity.subagents = liveSubagents(now, list);
    if (list) links = syncListed(links, list, now, knownTasks(bandModel));
    links = pruneLinks(links, now);
    for (const id2 of [...agentTools.keys()]) if (!links.some((l) => l.id === id2 && l.status !== "done")) agentTools.delete(id2);
    await refreshUsage($, true);
    await noteActivity($);
    if (!paneUp) {
      keepBand($, await buildPanel($));
      return;
    }
    await requestPanelWrite($);
  } catch {
  } finally {
    panelRefreshing = false;
  }
}
var TEXT = {
  es: {
    panel: "Panel",
    panelOpened: "Panel de progreso abierto.",
    panelWaiting: "El panel lens est\xE1 abierto pero a\xFAn no se muestra",
    nothing: "Nada que mostrar todav\xEDa",
    moreRows: (n2) => `\u2193 ${n2} m\xE1s \xB7 /lens foto`,
    bandHint: "ctrl+x tab \xB7 banda",
    photoTasks: (n2) => n2 === 0 ? "sin tareas" : n2 === 1 ? "1 tarea" : `${n2} tareas`,
    subagentsN: (n2) => `${n2} ${n2 === 1 ? "subagente" : "subagentes"}`,
    toastAccepted: (task, round) => round ? `${task} \xB7 aceptada en la ronda ${round}` : `${task} \xB7 aceptada`,
    toastVerdict: (task, action, counts2) => `${task} \xB7 veredicto ${action}${counts2 ? ` \xB7 ${counts2}` : ""}`,
    toastRound: (task, n2) => `${task} \xB7 ronda ${n2}`,
    toastIntegrated: (task, done, total) => `${task} integrada \xB7 ${done}/${total}`,
    runFinished: (done, total) => `Ejecuci\xF3n terminada: ${done}/${total} integradas`,
    runStopped: (why) => why ? `Ejecuci\xF3n parada: ${why}` : "Ejecuci\xF3n parada",
    noTask: "sin tarea en curso",
    track: "frente",
    decision: "decisi\xF3n pendiente",
    sRoadmap: "Roadmap",
    sSuperpowers: "superpowers",
    sNow: "Ahora",
    sTodos: "Pendientes",
    sSubagents: "Subagentes",
    sTasks: "Tareas de Claude Code",
    fixRound: "ronda",
    phase: "Fase",
    done: "hechas",
    open: "abiertas",
    tool: "herramienta",
    turn: "turno",
    sExecution: "Ejecuci\xF3n",
    manualRow: "manual",
    modeSubagents: "subagentes",
    modeSessions: "sesiones",
    alive: "viva",
    silent: "sin se\xF1al",
    stopped: "parada",
    queued: "por integrar",
    orphans: "hu\xE9rfanas",
    conflictsLbl: "en conflicto",
    blockedLbl: "bloqueadas",
    integratedN: "integradas",
    stage: { brief: "brief", implement: "implementar", validate: "validar", verify: "verificar", review: "revisar", verdict: "veredicto", integrate: "integrar", execution: "ejecuci\xF3n", triage: "triaje", design: "dise\xF1o", plan: "plan", final: "final" },
    sForge: "forge",
    approve: "Aprobar",
    reject: "Rechazar",
    hoursLeft: (hours) => `quedan ${hours} h`,
    auto: "auto",
    autoDecisions: (n2) => `${n2} ${n2 === 1 ? "decisi\xF3n autom\xE1tica" : "decisiones autom\xE1ticas"}`,
    autoMode: "modo auto",
    staleLedger: "sin cambios desde hace m\xE1s de un d\xEDa",
    sTasksInProgress: "Tareas en curso",
    otherSession: "otra sesi\xF3n",
    validating: "validando",
    integrating: "integrando",
    skipped: "omitida",
    noResult: "sin resultado",
    accepted: "aceptado",
    acceptedInRound: (n2) => `aceptado en la ronda ${n2}`,
    waitingOn: (n2, wake) => `esperando a ${n2} ${n2 === 1 ? "subagente" : "subagentes"}${wake ? ` \xB7 despierta en ${wake}` : ""}`,
    waitingLbl: "en espera",
    cached: "cach\xE9",
    reviewersLbl: "revisan",
    pressEnter: "Comando listo en el prompt: pulsa Enter",
    briefs: "briefs",
    cycle: "ciclo",
    task: "Tarea",
    proposals: "Propuestas",
    sUsage: "Consumo",
    effort: "esfuerzo",
    thisSession: "esta sesi\xF3n",
    active: "activo",
    sinceStart: "desde el inicio",
    taskTime: "tarea",
    run: "ejecuci\xF3n",
    gMain: "Sesi\xF3n principal",
    gImpl: "Implementadores",
    gReview: "Revisores",
    gVerify: "Verificaci\xF3n",
    blocked: "bloqueada",
    gPlan: "Planificaci\xF3n y scout",
    gOther: "Otros subagentes",
    tracking: "Seguimiento",
    withoutForge: "Sin forge (estimado)",
    withoutForgeNote: "orientativo: en una sola sesi\xF3n el contexto crecer\xEDa y costar\xEDa m\xE1s, y no habr\xEDa revisi\xF3n; el extremo bajo supone que todo el seguimiento se rele\xEDa en cada paso",
    forgeCosts: (usd, pct) => `forge cuesta +${usd} (+${pct} %)`,
    forgeSaves: (usd) => `forge ahorra \u2212${usd}`,
    pricesAsOf: "precios a",
    drift: "precios o medici\xF3n incompletos",
    various: "varios",
    noReview: "sin revisiones independientes",
    effortLevel: (e) => ({ low: "bajo", medium: "medio", high: "alto", xhigh: "muy alto", max: "m\xE1ximo" })[e] ?? e
  },
  en: {
    panel: "Panel",
    panelOpened: "Progress panel opened.",
    panelWaiting: "The lens panel is open but not shown yet",
    nothing: "Nothing to show yet",
    moreRows: (n2) => `\u2193 ${n2} more \xB7 /lens photo`,
    bandHint: "ctrl+x tab \xB7 band",
    photoTasks: (n2) => n2 === 0 ? "no tasks" : n2 === 1 ? "1 task" : `${n2} tasks`,
    subagentsN: (n2) => `${n2} subagent${n2 === 1 ? "" : "s"}`,
    toastAccepted: (task, round) => round ? `${task} \xB7 accepted in round ${round}` : `${task} \xB7 accepted`,
    toastVerdict: (task, action, counts2) => `${task} \xB7 verdict ${action}${counts2 ? ` \xB7 ${counts2}` : ""}`,
    toastRound: (task, n2) => `${task} \xB7 round ${n2}`,
    toastIntegrated: (task, done, total) => `${task} integrated \xB7 ${done}/${total}`,
    runFinished: (done, total) => `Execution finished: ${done}/${total} integrated`,
    runStopped: (why) => why ? `Execution stopped: ${why}` : "Execution stopped",
    noTask: "no task in progress",
    track: "track",
    decision: "decision pending",
    sRoadmap: "Roadmap",
    sSuperpowers: "superpowers",
    sNow: "Now",
    sTodos: "Todos",
    sSubagents: "Subagents",
    sTasks: "Claude Code tasks",
    fixRound: "round",
    phase: "Phase",
    done: "done",
    open: "open",
    tool: "tool",
    turn: "turn",
    sExecution: "Execution",
    manualRow: "manual",
    modeSubagents: "subagents",
    modeSessions: "sessions",
    alive: "alive",
    silent: "silent",
    stopped: "stopped",
    queued: "to integrate",
    orphans: "orphaned",
    conflictsLbl: "in conflict",
    blockedLbl: "blocked",
    integratedN: "integrated",
    stage: { brief: "brief", implement: "implement", validate: "validate", verify: "verify", review: "review", verdict: "verdict", integrate: "integrate", execution: "execution", triage: "triage", design: "design", plan: "plan", final: "final" },
    sForge: "forge",
    approve: "Approve",
    reject: "Reject",
    hoursLeft: (hours) => `${hours}h left`,
    auto: "auto",
    autoDecisions: (n2) => `${n2} automatic decision${n2 === 1 ? "" : "s"}`,
    autoMode: "auto mode",
    staleLedger: "unchanged for over a day",
    sTasksInProgress: "Tasks in progress",
    otherSession: "other session",
    validating: "validating",
    integrating: "integrating",
    skipped: "skipped",
    noResult: "no result",
    accepted: "accepted",
    acceptedInRound: (n2) => `accepted in round ${n2}`,
    waitingOn: (n2, wake) => `waiting on ${n2} subagent${n2 === 1 ? "" : "s"}${wake ? ` \xB7 wakes in ${wake}` : ""}`,
    waitingLbl: "waiting",
    cached: "cached",
    reviewersLbl: "reviewers",
    pressEnter: "Command ready in the prompt: press Enter",
    briefs: "briefs",
    cycle: "cycle",
    task: "Task",
    proposals: "Proposals",
    sUsage: "Usage",
    effort: "effort",
    thisSession: "this session",
    active: "active",
    sinceStart: "since start",
    taskTime: "task",
    run: "run",
    gMain: "Main session",
    gImpl: "Implementers",
    gReview: "Reviewers",
    gVerify: "Verification",
    blocked: "blocked",
    gPlan: "Planning and scout",
    gOther: "Other subagents",
    tracking: "Tracking",
    withoutForge: "Without forge (estimate)",
    withoutForgeNote: "rough: in one session the context would grow and cost more, with no review; the low end assumes all the tracking was re-read on every step",
    forgeCosts: (usd, pct) => `forge costs +${usd} (+${pct}%)`,
    forgeSaves: (usd) => `forge saves \u2212${usd}`,
    pricesAsOf: "prices as of",
    drift: "prices or measurement incomplete",
    various: "mixed",
    noReview: "no independent review",
    effortLevel: (e) => e
  }
};
var textsFor = (locale) => locale === "es" ? TEXT.es : TEXT.en;
var lensTexts = () => textsFor(roadmap.locale);
async function openPanel($) {
  const fresh = bandModel === null;
  if (fresh) await refreshPanel($, true);
  const t = lensTexts();
  let placed = false;
  try {
    const view = viewOf("terminal");
    const compact = panelLayout({ bodyColumns: view.columns ?? LINE_MAX, placement: "inline" });
    let estimate = 0;
    try {
      if (bandModel) estimate = buildCards(bandModel, t, 0).reduce((n2, card) => n2 + cardRows(card, compact), 0);
    } catch {
      estimate = 0;
    }
    const opened = await $.ui.open({ id: PANE, title: "lens", rows: paneRows(estimate, view.rows), columns: DOCK_COLUMNS });
    placed = opened.isPlaced;
    if (!opened.isPlaced) $.ui.toast(`${t.panelWaiting}: ${clip3(opened.reason, 200)}`);
  } catch {
    return false;
  }
  if (!fresh) {
    await refreshPanel($);
    return placed;
  }
  notePane($, await isPaneOpen($));
  if (paneUp) {
    startPanelTimer($);
    await requestPanelWrite($);
  }
  return placed;
}
var photos = /* @__PURE__ */ new Map();
var photoCount = 0;
async function takePhoto($) {
  const now = await nowMs($);
  if (sessionId === null) {
    try {
      sessionId = await sessionIdNow($);
    } catch {
    }
  }
  try {
    roadmap = await loadBandModel($);
    bandRead = true;
  } catch {
  }
  keepRunBaseline();
  try {
    panelFiles = await loadPanelFiles($, now);
  } catch {
  }
  try {
    const list = await agentList($);
    activity.subagents = liveSubagents(now, list);
    if (list) links = syncListed(links, list, now, knownTasks(bandModel));
    links = pruneLinks(links, now);
  } catch {
  }
  const model = await buildPanel($);
  keepBand($, model);
  const t = textsFor(model.locale);
  const tasks = model.activities.filter((a) => (a.kind === "forge" || a.kind === "workflow") && !a.done && !a.stopped).length;
  const n2 = ++photoCount;
  const text2 = photoText(n2, now, t.photoTasks(tasks));
  keepPhoto(photos, n2, { text: text2, cards: buildCards(model, t, now) });
  return text2;
}
var TOAST_GAP_MS = 5e3;
var FORGE_HEARD_MS = 10 * 6e4;
var lastStatus;
var prevModel = null;
var primed = false;
var lastToastAt = -Infinity;
var toastQueue = [];
var toastTimer = null;
var toastPending = false;
var TOAST_QUEUE_MAX = 5;
var TOAST_CELLS = 200;
var notified = /* @__PURE__ */ new Set();
var forgeHeardAt = null;
async function queueToasts($, texts) {
  toastQueue = [...toastQueue, ...texts].slice(0, TOAST_QUEUE_MAX);
  if (toastPending) return;
  toastPending = true;
  try {
    const wait = lastToastAt + TOAST_GAP_MS - await nowMs($);
    if (wait > 0) {
      toastTimer = $.clock.after(wait, () => {
        toastTimer = null;
        toastPending = false;
        void flushToasts($);
      });
      return;
    }
    toastPending = false;
    await flushToasts($);
  } catch {
    toastPending = false;
  }
}
async function flushToasts($) {
  if (!toastQueue.length) return;
  const text2 = clipWidth(toastQueue.splice(0).join(" \xB7 "), TOAST_CELLS);
  lastToastAt = await nowMs($);
  try {
    $.ui.toast(text2);
  } catch {
  }
}
function clearStatus($) {
  if (lastStatus === void 0) return;
  lastStatus = void 0;
  try {
    $.ui.status(void 0);
  } catch {
  }
}
function updateStatus($, model) {
  try {
    const view = viewOf("terminal");
    const show = view.fullscreen === false || view.maxRows !== null && view.maxRows < 3;
    const text2 = show && model ? statusText(model, textsFor(model.locale), runRoleOf(roadmap)) ?? void 0 : void 0;
    if (text2 === lastStatus) return;
    lastStatus = text2;
    try {
      $.ui.status(text2);
    } catch {
    }
  } catch {
  }
}
async function updateSurfaces($, model) {
  try {
    const t = textsFor(model.locale);
    const role = runRoleOf(roadmap);
    updateStatus($, model);
    if (!primed) {
      primed = true;
      prevModel = model;
      return;
    }
    const moved = surfaceEvents(prevModel, model, role, t);
    prevModel = model;
    if (moved.toasts.length) await queueToasts($, moved.toasts);
    if (moved.ended && !notified.has(moved.ended.runId)) {
      notified.add(moved.ended.runId);
      let sent = false;
      try {
        sent = (await $.ui.notify(moved.ended.text).catch(() => null))?.isSent === true;
      } catch {
        sent = false;
      }
      if (!sent) await queueToasts($, [moved.ended.text]);
    }
  } catch {
  }
}
var RISK_HUE = { low: "green", medium: "yellow", high: "red" };
function decide($, t, id2, d) {
  if (!PROPOSAL_ID.test(id2)) return;
  const args = `${id2} ${d}`;
  $.command.run({ command: "forge:decide", args }).catch(async () => {
    try {
      await $.prompt.fill({ text: `/forge:decide ${args}`, mode: "replace" });
      $.ui.toast(t.pressEnter);
    } catch {
    }
  });
}
var pushCapped = (list, item) => [...list, item].slice(-MAX_ACTIVITY);
export const register = (on) => {
  on("session.start", async ($, e, next) => {
    resetPanel();
    resetUsage();
    clearStatus($);
    endedId = null;
    try {
      await syncUsageStart($);
    } catch {
    }
    waypointBand = false;
    waypointLoaded = null;
    roadmap = noneBand();
    try {
      if (await read($, hidden)) await update($, hidden, () => false);
    } catch {
    }
    try {
      await $.command.register({ name: "lens", description: "Show the lens progress panel", argumentHint: "[live|foto]", immediate: true });
    } catch {
    }
    timer?.cancel();
    timer = $.clock.every(3e4, () => {
      void tick($);
    });
    stopPanelTimer();
    await refreshPanel($);
    return next(e);
  });
  on("session.end", async ($, e, next) => {
    try {
      endTurn(usage, turnClock, await nowMs($));
      syncTurn();
    } catch {
    }
    try {
      const u = await $.session.usage();
      if (u.startedAt === usageStartedAt) takeOfficial(u);
    } catch {
    }
    try {
      await writeUsageFile($, true);
    } catch {
    }
    if (e.reason === "clear" || e.reason === "resume") {
      endedId = typeof e.sessionId === "string" && e.sessionId ? e.sessionId : null;
      try {
        resetUsage();
      } catch {
      }
      if (e.reason === "clear") {
        try {
          resetPanel();
          clearStatus($);
        } catch {
        }
        const r = await next(e);
        void requestPanelWrite($);
        return r;
      }
      return next(e);
    }
    timer?.cancel();
    timer = null;
    stopPanelTimer();
    writeTimer?.cancel();
    writeTimer = null;
    paneUp = false;
    return next(e);
  });
  on("session.compact", async ($, e, next) => {
    const r = await next(e);
    try {
      const skipped = !!r && typeof r.skip === "string";
      if (!e.agentId && e.trigger !== "precompute" && !skipped) compactUsage(usage);
    } catch {
    }
    return r;
  }).catch(($, e, next) => next(e));
  on("command.run", { command: "lens" }, async ($, e) => {
    const t = lensTexts();
    if (lensMode(e.args, e.presentation) === "photo") return { text: await takePhoto($) };
    const placed = await openPanel($);
    return { text: placed ? t.panelOpened : `${t.panelWaiting}.` };
  });
  on("ui.render", { component: "CommandOutput", props: { command: "lens" } }, async ($, e, next) => {
    try {
      const n2 = photoId(e.props.text);
      const shot = n2 === null ? void 0 : photos.get(n2);
      if (!shot || shot.text !== e.props.text) return next(e);
      const ui = $.ui.resolve(e);
      const { Box, Text } = ui;
      const layout = panelLayout({ bodyColumns: transcriptColumns(e.surface, e.viewport), placement: "inline" });
      const Svg = e.surface !== "terminal" && "Svg" in ui ? ui.Svg : null;
      const W = Math.max(240, Math.min(900, layout.cols * 8 - 8));
      return /* @__PURE__ */ h(Box, { flexDirection: "column", rowGap: Svg ? 1 : 0 }, /* @__PURE__ */ h(Text, { dimColor: true }, e.props.text), shot.cards.map((card, i) => {
        if (!Svg) return termCard({ Box, Text }, `photo-${n2}-${i}`, card, layout);
        const { source, height } = cardSvg(card, W);
        return /* @__PURE__ */ h(Svg, { key: `photo-${n2}-${i}`, source, alt: cardAlt(card), width: W, height });
      }));
    } catch {
      return next(e);
    }
  });
  on("ui.close", async ($, e, next) => {
    const closed = await next(e);
    if (e.id === PANE) {
      notePane($, await isPaneOpen($));
      if (!paneUp) stopPanelTimer();
    }
    return closed;
  }).catch(($, e, next) => next(e));
  on("turn.start", async ($, e, next) => {
    try {
      startTurn(usage, turnClock, await nowMs($));
      syncTurn();
      void requestPanelWrite($);
    } catch {
    }
    return next(e);
  });
  on("turn.complete", async ($, e, next) => {
    if (!e.agentId) {
      try {
        endTurn(usage, turnClock, await nowMs($));
      } catch {
        turnClock.since = null;
      }
      syncTurn();
      void refreshPanel($);
    } else {
      try {
        const id2 = e.agentId;
        const now = await nowMs($);
        if (links.some((l) => l.id === id2)) links = endAgent(links, id2, now);
        else {
          for (const [k, at] of pendingEnds) if (now - at > PENDING_END_MS) pendingEnds.delete(k);
          pendingEnds.delete(id2);
          pendingEnds.set(id2, now);
          while (pendingEnds.size > PENDING_ENDS_MAX) pendingEnds.delete(pendingEnds.keys().next().value);
        }
        void requestPanelWrite($);
      } catch {
      }
    }
    return next(e);
  });
  on("turn.step", async function* ($, e, next) {
    void touch($);
    const r = yield* next(e);
    void touch($);
    try {
      recordStep(usage, { agentId: e.agentId, model: e.model, effort: e.effort, usage: r?.usage ?? null });
      void requestPanelWrite($);
    } catch {
    }
    return r;
  });
  on("agent.spawn", async ($, e, next) => {
    const r = await next(e);
    try {
      if (r?.agentId) {
        labelLoop(usage, r.agentId, String(e.subagentType ?? "unknown"), e.description);
        const wf = e.workflow;
        const now = await nowMs($);
        links = linkSpawn(links, {
          id: r.agentId,
          type: String(e.subagentType ?? ""),
          description: String(e.description ?? ""),
          prompt: typeof e.prompt === "string" ? e.prompt : "",
          parentId: typeof e.parentAgentId === "string" ? e.parentAgentId : null,
          workflow: wf && typeof wf.runId === "string" ? { runId: wf.runId, index: Number(wf.agentIndex) || 0 } : null,
          now
        }, knownTasks(bandModel));
        applyPendingEnd(r.agentId, now);
        void noteActivity($);
        void requestPanelWrite($);
      }
    } catch {
    }
    return r;
  }).catch(($, e, next) => next(e));
  on("tool.call", async ($, e, next) => {
    const mine = !e.agentId;
    const input = e;
    const callId = typeof e.tool_use_id === "string" && e.tool_use_id ? e.tool_use_id : null;
    void touch($);
    const started = await nowMs($);
    if (mine) {
      try {
        tools.delete(e.tool_use_id);
        tools.set(e.tool_use_id, { name: clip3(String(e.tool), LINE_MAX), since: started });
        while (tools.size > MAX_ACTIVITY) tools.delete(tools.keys().next().value);
        showTool();
        if (e.tool === "TodoWrite") {
          activity.todos = Array.isArray(e.todos) ? e.todos.slice(0, MAX_TODOS) : e.todos;
          void noteActivity($);
        }
        void requestPanelWrite($);
      } catch {
      }
    } else {
      try {
        const id2 = e.agentId;
        if (callId) {
          const calls = agentTools.get(id2) ?? /* @__PURE__ */ new Map();
          calls.delete(callId);
          calls.set(callId, { name: String(e.tool), since: started });
          while (calls.size > MAX_ACTIVITY) calls.delete(calls.keys().next().value);
          agentTools.delete(id2);
          agentTools.set(id2, calls);
          while (agentTools.size > LINKS_MAX) agentTools.delete(agentTools.keys().next().value);
          showAgentTool(id2);
        } else links = setTool(links, id2, { name: String(e.tool), since: started });
        void requestPanelWrite($);
      } catch {
      }
    }
    try {
      const result = await next(e);
      try {
        const answer = result;
        if (answer && typeof answer.deny !== "string") {
          if (e.tool === "Bash") {
            const own = ownTaskOf(input.command);
            ownTasks = addOwnTask(ownTasks, own);
            if (own) {
              forgeHeardAt = await nowMs($);
              void noteActivity($);
            }
          }
          if (mine && e.tool === "ScheduleWakeup") {
            const delay = typeof input.delaySeconds === "number" && Number.isFinite(input.delaySeconds) ? input.delaySeconds : null;
            wakeAt = input.stop === true || delay === null || answer.isError === true ? null : started + Math.min(WAKE_MAX_S, Math.max(WAKE_MIN_S, delay)) * 1e3;
          }
        }
      } catch {
      }
      if (mine) {
        try {
          const kind = trackingKind(String(e.tool), input);
          if (kind) {
            const r = result;
            const out = typeof r?.text === "string" ? r.text.length : (JSON.stringify(r?.result ?? "") ?? "").length;
            recordTracking(usage, kind, JSON.stringify(e).length + out);
          }
        } catch {
        }
      }
      return result;
    } finally {
      void touch($);
      if (mine && tools.delete(e.tool_use_id)) {
        showTool();
        void requestPanelWrite($);
      }
      if (!mine) {
        const id2 = e.agentId;
        if (callId) {
          const calls = agentTools.get(id2);
          calls?.delete(callId);
          if (calls && !calls.size) agentTools.delete(id2);
          showAgentTool(id2);
        } else links = endTool(links, id2, String(e.tool));
        void requestPanelWrite($);
      }
    }
  }).catch(($, e, next) => next(e));
  on("classic.SubagentStart", async ($, e, next) => {
    try {
      const id2 = String(e.agent_id);
      finished = finished.filter((f) => f.id !== id2);
      activity.subagents = pushCapped(activity.subagents.filter((s) => s.id !== id2), { id: id2, type: clip3(String(e.agent_type ?? ""), LINE_MAX), since: await nowMs($) });
      const kind = usage.loops[id2]?.kind;
      if (!kind || kind === "unknown") labelLoop(usage, id2, String(e.agent_type ?? "unknown"));
      if (!links.some((l) => l.id === id2)) {
        const now = await nowMs($);
        links = linkSpawn(links, { id: id2, type: String(e.agent_type ?? ""), description: "", prompt: "", parentId: null, workflow: null, now }, knownTasks(bandModel));
        applyPendingEnd(id2, now);
      }
      await touch($);
      await noteActivity($);
      void requestPanelWrite($);
    } catch {
    }
    return next(e);
  }).catch(($, e, next) => next(e));
  on("classic.SubagentStop", async ($, e, next) => {
    try {
      void touch($);
      const id2 = String(e.agent_id);
      const ran = activity.subagents.find((s) => s.id === id2);
      activity.subagents = activity.subagents.filter((s) => s.id !== e.agent_id);
      links = endAgent(links, id2, await nowMs($), { any: true });
      if (ran) recordFinished(ran, await nowMs($));
      void noteActivity($);
      void requestPanelWrite($);
    } catch {
    }
    return next(e);
  }).catch(($, e, next) => next(e));
  on("classic.TaskCreated", ($, e, next) => {
    try {
      const id2 = String(e.task_id);
      activity.ccTasks = pushCapped(activity.ccTasks.filter((c2) => c2.id !== id2), { id: id2, subject: String(e.task_subject ?? ""), done: false });
      void requestPanelWrite($);
    } catch {
    }
    return next(e);
  }).catch(($, e, next) => next(e));
  on("classic.TaskCompleted", ($, e, next) => {
    try {
      const id2 = String(e.task_id);
      const known = activity.ccTasks.some((c2) => c2.id === id2);
      activity.ccTasks = known ? activity.ccTasks.map((c2) => c2.id === id2 ? { ...c2, done: true } : c2) : pushCapped(activity.ccTasks, { id: id2, subject: String(e.task_subject ?? ""), done: true });
      void requestPanelWrite($);
    } catch {
    }
    return next(e);
  }).catch(($, e, next) => next(e));
  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e, next) => {
    try {
      noteRender($, e.surface, e.viewport, { docked: e.props.placement === "dock" });
      updateStatus($, bandModel);
      const layout = panelLayout(e.props, e.viewport);
      if (layout.focusAgent !== focusAgent) {
        focusAgent = layout.focusAgent;
        void requestPanelWrite($);
      }
      const m = await read($, panel);
      const t = m ? textsFor(m.locale) : lensTexts();
      const nowMs2 = m?.waypoint?.current?.startedAt ? await $.clock.now() : 0;
      const proposals = (m?.proposals ?? []).filter((p) => PROPOSAL_ID.test(p.id));
      const ui = $.ui.resolve(e);
      const { Box, Text, Button } = ui;
      const Svg = e.surface !== "terminal" && "Svg" in ui ? ui.Svg : null;
      const all = m ? buildCards(m, t, nowMs2) : [];
      const reserve = proposals.length ? 3 + 3 * proposals.length : 0;
      const avail = layout.rows === null ? null : Math.max(1, layout.rows - reserve);
      let fitted = Svg || avail === null ? { cards: all, hidden: 0 } : fitCards(all, { ...layout, rows: avail });
      let more = fitted.hidden;
      if (!Svg && avail !== null && fitted.cards.length) {
        const moreRow = fitted.hidden > 0 && avail >= 2;
        const room = moreRow ? avail - 1 : avail;
        const shown = fitted.cards.reduce((n2, card) => n2 + cardRows(card, layout), 0);
        if (shown > room) {
          const clipped = clipCard(fitted.cards[0], layout, room);
          fitted = { ...fitted, cards: [clipped] };
          more += shown - cardRows(clipped, layout);
        }
        if (!moreRow) more = 0;
      }
      const W = Math.max(240, Math.min(900, layout.cols * 8 - 8));
      const drawn = fitted.cards.map((card, i) => {
        if (!Svg) return termCard(ui, `card-${i}`, card, layout);
        const { source, height } = cardSvg(card, W);
        return /* @__PURE__ */ h(Svg, { key: `card-${i}`, source, alt: cardAlt(card), width: W, height });
      });
      return /* @__PURE__ */ h(Box, { flexDirection: "column", rowGap: Svg ? 1 : 0 }, drawn.length || proposals.length ? drawn : /* @__PURE__ */ h(Text, { dimColor: true }, t.nothing), proposals.length ? /* @__PURE__ */ h(Box, { key: "section-proposals", flexDirection: "column", borderStyle: "round", borderColor: PALETTE.yellow, paddingX: 1 }, /* @__PURE__ */ h(Text, { bold: true, color: PALETTE.yellow }, `\u2727 ${t.proposals} \xB7 ${proposals.length}`), proposals.map((p) => /* @__PURE__ */ h(Box, { key: `proposal-${p.id}`, flexDirection: "column", marginTop: 1 }, /* @__PURE__ */ h(Text, { bold: true, wrap: "truncate-end" }, clip3(p.title, layout.cols)), /* @__PURE__ */ h(Box, { flexDirection: "row", columnGap: 1, flexWrap: "wrap" }, /* @__PURE__ */ h(Text, { color: PALETTE.lavender }, `\u2039${p.category}\u203A`), /* @__PURE__ */ h(Text, { color: PALETTE[RISK_HUE[p.risk] ?? "yellow"] }, `\u2039${p.risk}\u203A`), /* @__PURE__ */ h(Button, { key: `approve-${p.id}`, label: `\u2713 ${t.approve}`, onPress: () => decide($, t, p.id, "approve") }), /* @__PURE__ */ h(Button, { key: `reject-${p.id}`, label: `\u2717 ${t.reject}`, onPress: () => decide($, t, p.id, "reject") }))))) : null, more ? /* @__PURE__ */ h(Text, { key: "more", dimColor: true }, t.moreRows(more)) : null);
    } catch {
      return next(e);
    }
  });
  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    const below = await next(e);
    noteRender($, e.surface, e.viewport, { maxRows: e.props.maxRows, body: e.props.bodyColumns });
    updateStatus($, bandModel);
    try {
      if (e.props.hasSurvey || !busy) return below;
      if (await waypointDraws($)) {
        waypointSeen = true;
        return below;
      }
      if (waypointSeen) {
        waypointSeen = false;
        void nowMs($).then((at) => {
          takeoverAt = at;
        });
      }
      const subject = subjectOf(bandModel);
      if (await read($, hidden) && hiddenSubject === subject) return below;
      const ui = $.ui.resolve(e);
      const { Box, Button } = ui;
      const t = lensTexts();
      const fullscreen = e.viewport?.isFullscreen !== false;
      const cols = Number(e.props.bodyColumns) > 0 ? Math.floor(Number(e.props.bodyColumns)) : DEFAULT_COLUMNS;
      const maxRows = Number(e.props.maxRows) > 0 ? Number(e.props.maxRows) : 10;
      const plain = !fullscreen;
      const shape = lensBand(bandModel, t, activity.subagents.length);
      const buttonsWidth = 1 + controlWidth(t.panel, { plain, hotkey: "p" }) + 1 + controlWidth("\xD7", { plain, hotkey: "x" });
      const boxes = shape.cells.slice(0, BAND_CELLS);
      const wide = bandLevel({ bodyColumns: cols, maxRows, fullscreen }) === "wide" && boxes.length > 0;
      const extra = wide ? 1 + BAR_MIN + 1 + boxes.length * 2 : 0;
      const shown = fitParts(shape.parts, cols - ICON_COLUMNS - buttonsWidth - extra).shown;
      const barWidth = wide ? Math.max(BAR_MIN, Math.min(BAR_MAX, cols - ICON_COLUMNS - buttonsWidth - partsWidth(shown) - 1 - boxes.length * 2 - 1)) : 0;
      const screen = Number(e.viewport?.columns) > 0 ? Number(e.viewport?.columns) : cols + 5;
      const form = fullscreen && screen >= DOCK_MIN_COLUMNS ? "live" : "foto";
      const plainProp = plain ? { plain: true } : {};
      const buttons = [
        /* @__PURE__ */ h(Button, { key: "panel", label: t.panel, hotkey: "p", ...plainProp, onPress: () => {
          runLens($, form);
        } }),
        /* @__PURE__ */ h(Button, { key: "dismiss", label: "\xD7", role: "dismiss", hotkey: "x", ...plainProp, onPress: () => {
          void closeBand($, subject);
        } })
      ];
      const icon = SECTION_ICON[shape.section];
      const hue = SECTION_HUE[shape.section];
      if (e.surface !== "terminal" && "Svg" in ui) {
        const { Svg } = ui;
        const W = Math.max(200, Math.min(1600, cols * 8 - 130));
        const title = joinParts(shown);
        const { source, height } = bandSvg({ W, icon, title, detail: "", hue, ratio: shape.ratio, label: "", moving: true, cells: shape.cells });
        return /* @__PURE__ */ h(Box, { flexDirection: "column" }, /* @__PURE__ */ h(Box, { flexDirection: "row", alignItems: "center", columnGap: 1 }, /* @__PURE__ */ h(Svg, { source, alt: title, width: W, height }), buttons), below);
      }
      return /* @__PURE__ */ h(Box, { flexDirection: "column" }, /* @__PURE__ */ h(Box, { key: "band-row", flexDirection: "row", columnGap: 1 }, termBand(ui, { icon, hue, spin: shape.spin, parts: shown, bar: wide ? { ratio: shape.ratio, width: barWidth, moving: true } : null, cells: wide ? boxes : [] }), /* @__PURE__ */ h(Box, { flexDirection: "row", columnGap: 1, flexShrink: 0 }, buttons)), below);
    } catch {
      return below;
    }
  });
  on("ui.render", { component: "PromptHint" }, async ($, e, next) => {
    try {
      if (e.viewport?.isFullscreen === false && !e.props.tail && await bandUp($)) return next({ ...e, props: { ...e.props, tail: lensTexts().bandHint } });
    } catch {
    }
    return next(e);
  });
  on("ui.render", { component: "Spinner" }, async ($, e, next) => {
    try {
      if (e.props.message === null) {
        const message = spinnerText(bandModel, bandModel ? textsFor(bandModel.locale) : lensTexts());
        if (message) return next({ ...e, props: { ...e.props, message } });
      }
    } catch {
    }
    return next(e);
  });
  on("ui.render", { component: "SessionMode" }, async ($, e, next) => {
    try {
      const extra = modeLabels(bandModel).filter((x) => !e.props.modes.includes(x));
      if (extra.length) return next({ ...e, props: { ...e.props, modes: [...e.props.modes, ...extra] } });
    } catch {
    }
    return next(e);
  });
};
