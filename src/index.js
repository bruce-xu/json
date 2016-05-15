/**
 * @file ECMAScript 5 JSON polyfill
 * @author brucexyj@gmail.com
 */
(function (global, undefined) {
    // if (typeof global.JSON === 'object' && typeof global.JSON.parse === 'function' && typeof JSON.stringify === 'function') {
    //     return;
    // }

    global.JSON = (function () {
        // 分隔符正则表达式，遇到任一如下分隔符时，都会处理
        var SEPARATOR_PATTERN = /[\{\}\[\]\,:"]/g;
        // 空白符正则表达式
        var SPACE_PATTERN = /^\s*$/;
        // 字面量正则表达式。 ES5中的JSON.parse 解析json字符串时，当遇到如下形式的字符串，会直接转换成相应的基本类型值：
        // - 'null'
        // - 'true'
        // - 'false'
        // - '0'，'1.1'，'-123'
        // - '"anything"'
        // 其中'null'，'true'，'false'必须为小写字母；数字可以为正值也可以为负值，正值无需也不能加`+`；字符串必须为双引号包裹；
        // 上述各值的两边都可以有任意数量的空白符
        var LITERAL_PATTERN = /^(null|true|false|(-?0|-?\d+\.\d+|-?[1-9]\d*)|"(.*)")$/;
        // 字符串字面量对应的基本值
        var LITERAL_MAPPING = {
            'null': null,
            'true': true,
            'false': false
        };
        // 对象或数组的匹配状态。只有当前匹配到的项符合当前应该出现的位置时才会成功匹配，否则匹配失败
        // 简单起见，此处对象和数组使用了相同的状态列表，只不过匹配数组时跳过不会出现的状态
        var State = {
            START: 0,       // 开始匹配对象或数组，及遇到了`{`或`[`
            KEY_DONE: 1,    // 匹配到了对象的key
            FOR_VALUE: 2,   // 匹配到了对象key/value的分隔符`:`
            VALUE_DONE: 3,  // 匹配到了对象或数组的值
            FOR_NEXT: 4,    // 匹配到了对象或数组内项的分隔符`,`
        };

        /**
         * 简单的栈实现
         */
        function Stack() {
            this.raw = [];
        }

        Stack.prototype = {
            constructor: Stack,

            push: function (item) {
                this.raw.push(item);
            },

            pop: function () {
                this.raw.pop();
            },

            top: function () {
                return this.raw[this.raw.length - 1];
            },

            bottom: function () {
                return this.raw[0];
            },

            update: function (value) {
                this.raw[this.raw.length - 1] = value;
            }
        };

        /**
         * 解析json字符串为json对象
         *
         * @param {string} source json字符串
         * @return {Mixed} 解析后的值。如果source为基本类型的值，或基本类型数值的字符串形式，则直接返回基本类型的值；
         *  否则返回解析后的对象或数组；若解析失败则抛出异常
         */
        function parse(source) {
            // 原生的JSON.parse也可以接受基本类型值如true，1等，并返回基本类型的值。为方便处理，统一转成字符串
            source += '';
            // 首先去除两边的空格，然后处理转义符
            source = source.replace(/^\s*|\s*$/g, '').replace('\\\\', '\\');

            var detectLiteralResult = getLiteral(source);
            if (typeof detectLiteralResult !== 'undefined') {
                return detectLiteralResult;
            }
            
            var contextStack = new Stack();
            var stateStack = new Stack();
            var match;
            var operator;
            var target;
            var type;
            var text;
            var key;
            var value;
            var needQuot = false;
            var needColon = false;
            var cursor = 0;
            var state = 0;
            while (match = SEPARATOR_PATTERN.exec(source)) {
                operator = match[0];
                target = contextStack.top();
                state = stateStack.top();
                type = getType(target);
                text = source.slice(cursor, match.index).replace(/^\s*|\s$/g, '');
                cursor = match.index + 1;

                // 因为双引号内可以包含任意字符，包括`{，}，[，]，,，:`这些需要匹配的操作符，所以当遇到双引号后，不再匹配这些特殊操作符，
                // 直到遇到另一双引号结束当前引号对的匹配
                if (needQuot) {
                    if (operator !== '"' || text.charAt(text.length - 1) === '\\') {
                        continue;
                    }

                    // 引号对已匹配成功，设置标志位为false，为下一次引号对匹配做准备
                    needQuot = false;
                    // 如果当前的类型是对象的话，则上述引号对内的值可能是对象的key或value
                    if (type === 'Object') {
                        // 如果当前的对象刚开始匹配，或上一个键值对已匹配成功，并也匹配到了不同键值对的分隔符`,`，则引号内的值应该是当前对象的下一个key
                        if (state === State.START || state === State.FOR_NEXT) {
                            key = text;
                            // 已匹配到了key，更新当前对象的状态
                            stateStack.update(State.KEY_DONE);
                        }
                        // 如果当前对象上一次已经匹配到了键值对的分隔符`:`，则引号内的值是当前对象的下一个value
                        else if (state === State.FOR_VALUE) {
                            value = text;
                            // 为当前对象添加值
                            addItem();
                            // 已匹配到了value，更新当前对象的状态
                            stateStack.update(State.VALUE_DONE);
                        }
                        else {
                            // 如果当前对象不是上述状态，但此时却遇到上述引号内的字符串，说明json字符串格式有误
                            error();
                        }
                    }
                    // 如果当前的类型是数组的话，则上述引号对内的值可能是数组的项
                    else if (type === 'Array') {
                        if (state === State.START || state === state.FOR_NEXT) {
                            value = text;
                            // 为当前数组添加项
                            addItem();
                            // 已匹配到了value，更新当前对象的状态
                            stateStack.update(State.VALUE_DONE);
                        }
                        else {
                            error();
                        }
                    }
                    else {
                        error();
                    }
                }
                else {
                    // 如果上一次匹配的不是双引号，但现在匹配的是，则进去下一次匹配，且在下一次匹配到双引号之前，忽略其它匹配到的字符
                    if (operator === '"') {
                        // 开始引号前面不应该出现非空文本
                        if (isEmpty(text)) {
                            needQuot = true;
                            continue;
                        }
                        else {
                            error();
                        }
                    }
                }

                switch (operator) {
                    // 匹配到了对象，对象可以出现在几种地方：最外层，某个对象的属性值，某个数值的项
                    case '{':
                        if (isEmpty(text)) {
                            value = {};
                            addItem();
                        }
                        else {
                            error();
                        }
                        break;
                    // 匹配到了对象结束
                    case '}':
                        if (type !== 'Object') {
                            // 如果当前上下文target不是对象，但现在匹配到了对象结束符，说明是错误的格式
                            error();
                        }
                        else {
                            // 如果还没匹配到值，只有可能是值是除字符串外的基本类型
                            if (state === State.FOR_VALUE) {
                                value = getLiteral(text);
                                if (typeof value !== 'undefined') {
                                    addItem();
                                    text = '';
                                }
                                else {
                                    error();
                                }
                            }

                            if ((state === State.START || state === State.VALUE_DONE) && isEmpty(text)) {
                                contextStack.pop();
                                stateStack.pop();
                            }
                            else {
                                error();
                            }
                        }
                        break;
                    // 匹配到了数组，数组可以出现在几种地方：最外层，某个对象的属性值，某个数值的项
                    case '[':
                        if (isEmpty(text)) {
                            value = [];
                            addItem();
                        }
                        else {
                            error();
                        }
                        break;
                    // 匹配到了数组结束
                    case ']':
                        if (type !== 'Array') {
                            error();
                        }
                        else {
                            if (state === State.START || state === State.FOR_NEXT) {
                                value = getLiteral(text);
                                if (typeof value !== 'undefined' || state === State.START) {
                                    addItem();
                                    text = '';
                                }
                                else {
                                    error();
                                }
                            }

                            if (state === State.VALUE_DONE && isEmpty(text)) {
                                contextStack.pop();
                                stateStack.pop();
                            }
                            else {
                                error();
                            }
                        }
                        break;
                    case ':':
                        if (type === 'Object' && state === State.KEY_DONE && isEmpty(text)) {
                            stateStack.update(State.FOR_VALUE);
                        }
                        else {
                            error();
                        }
                        break;
                    case ',':
                        if (type === 'Object' || type === 'Array') {
                            if (type === 'Object' && state === State.FOR_VALUE
                                || type === 'Array' && (state === State.START || state === State.FOR_NEXT)
                            ) {
                                value = getLiteral(text);
                                if (typeof value !== 'undefined' || (type === 'Array' && State === State.START)) {
                                    addItem();
                                }
                                else {
                                    error();
                                }
                            }
                            else if (state !== State.VALUE_DONE) {
                                error();
                            }

                            stateStack.update(State.FOR_NEXT);
                        }
                        else {
                            error();
                        }
                        break;
                    default:
                        break;
                }
            }

            /**
             * 为对象或数组添加值（由于要用到很多参数，方便起见，作为内部方法实现）
             */
            function addItem() {
                if (target) {
                    if (type === 'Object' && state === State.FOR_VALUE) {
                        target[key] = value;
                        state = State.VALUE_DONE;
                        stateStack.update(State.VALUE_DONE);
                    }
                    else if (type === 'Array' && (state === State.START || state === State.FOR_NEXT)) {
                        target.push(value);
                        state = State.VALUE_DONE;
                        stateStack.update(State.VALUE_DONE);
                    }
                    else {
                        error();
                    }
                }

                var valueType = getType(value);
                // 如果当前的值是对象或数组，则设置context为当前值，接下来匹配的将是当前值的属性或项
                if (valueType === 'Object' || valueType === 'Array') {
                    contextStack.push(value);
                    stateStack.push(State.START);
                }
            }

            return target;
        }

        /**
         * 获取目标的类型
         *
         * @param {Mixed} target 目标对象
         * @return {string} 类型字符串
         */
        function getType(target) {
            var match = /\[object (\w+)\]/.exec(Object.prototype.toString.call(target));
            if (match) {
                return match[1];
            }
        }

        /**
         * 判断文本是否是除空格外的空字符串
         *
         * @param {string} text 待检查的字符串文本
         * @return {boolean} true or false
         */
        function isEmpty(text) {
            return SPACE_PATTERN.test(text);
        }

        /**
         * 获取字符串对应的基本类型字面量
         *
         * @param {string} text 待获取值的字符串文本
         * @return {Mixed} 基本类型字面量
         */
        function getLiteral(text) {
            var match = LITERAL_PATTERN.exec(text.replace(/^\s*|\s*$/g, ''));
            if (match) {
                if ([match[1]] in LITERAL_MAPPING) {
                    return LITERAL_MAPPING[match[1]];
                }
                else if (match[2]) {
                    return parseFloat(match[2]);
                }
                else if (match[3]) {
                    return match[3];
                }
            }

            return undefined;
        }

        /**
         * 解析出错，抛出异常
         *
         * @param {string} 错误消息
         */
        function error(msg) {
            throw new Error(msg || 'Invalid json string');
        }

        /**
         * 将json对象序列化成字符串
         *
         * @param {Mixed} value 待序列化的目标对象
         * @return {string} 序列化后的字符串
         */
        function stringify(value) {
            var result = '';

            switch (getType(value)) {
                case 'Undefined':
                    result = undefined;
                    break;
                case 'Null':
                    result = 'null';
                    break;
                case 'Number':
                    result = Number(value).toString();
                    break;
                case 'Boolean':
                    result = Boolean(value).toString();
                    break;
                case 'String':
                    result = '"' + value.replace('"', '\\"') + '"';
                    break;
                case 'Object':
                    var tmp = [];
                    for (var key in value) {
                        if (value.hasOwnProperty(key)) {
                            tmp.push('"' + key + '": ' + stringify(value[key]));
                        }
                    }
                    result += '{' + tmp.join(', ') + '}';
                    break;
                case 'Array':
                    var tmp = [];
                    for (var i = 0, len = value.length; i < len; i++) {
                        tmp.push(stringify(value[i]));
                    }
                    result += '[' + tmp.join(', ') + ']';
                    break;
                default:
                    result = '"' + value.toString() + '"';
            }

            return result;
        }

        return {
            parse: parse,
            stringify: stringify
        };
    })();

    // Just for test
    global._json_ = global.JSON;
})(this);