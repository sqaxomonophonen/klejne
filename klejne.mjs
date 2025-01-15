const DEFAULT_TOKENIZER_SETUP = {
    mix                : "::",
    directive          : ":",
    variable_sigil     : "$",
    macro_sigil        : "*",
    state_tag          : "&",
    string             : ['"', "'", "`", ["«","»"], ["»","«"]],
    javascript_string  : "#", // you have no string escapes; pick a character you don't use in JS
    parenthesis        : [["(",")"], ["[","]"], ["{","}"], ["<",">"],["‹","›"]],
    chain              : "..",
    assignment         : "=",
    number_decimal     : ".",
    identifier_chars   : ["az","AZ","09","_","?","!",","],
    comment            : ["--", "//", ";"],
    whitespace         : " \t",
    newline            : "\n",
}

const DEFAULT_KEYWORDS = {
    scope : [ "my", "our" ], // oh hi perl
    macro : "macro",
    send  : "send",
    bpm   : "bpm",
};

function ASSERT(p,msg) { if (!p) throw new Error("ASSERTION FAILED" + (msg ? (": "+msg) : "")); }
function ASSERT_SAME_REPR(v0,v1,msg) { const j0=JSON.stringify(v0),j1=JSON.stringify(v1); ASSERT(j0===j1, `${j0} !== ${j1}` + (msg ? (" :: "+msg) : "")); }
const UNIT_TEST=fn=>fn(); // (define as no-op if you don't want to run unit tests?)

function resize_typed_array(xs,n) {
    if (n === xs.length) return xs; // no change in size
    if (n < xs.length) return xs.subarray(0,n); // shrink
    let grown_xs = new xs.constructor(n);
    grown_xs.set(xs);
    return grown_xs;
}

function string_to_codepoints(string) { // "abc" => new Uint32Array([97,98,99])
    let codepoints = new Uint32Array(string.length);
    let n=0;
    for (const c of string) codepoints[n++] = c.codePointAt(0);
    return resize_typed_array(codepoints,n); // resize if codepoints count is less than string.length (code units count)
}

UNIT_TEST(_=>{
    for (const cps0 of [[96], [96,97], /*large codepoints require 2 UTF-16 code units => */ [100000], [100000,99,100001]]) {
        let str = ""; for (let codepoint of cps0) str += String.fromCodePoint(codepoint)
        ASSERT(str.length === cps0.reduce((x,y)=>x+(y>65535?2:1),0), "unexpected UTF-16 code unit count (which differs from codepoint count)");
        let cps1 = string_to_codepoints(str);
        ASSERT(cps0.length === cps1.length);
        for (let i=0; i<cps1.length; ++i) ASSERT(cps1[i] === cps0[i]);
    }
})

// klejne code has colors and stuff that makes strings "fat":
class FatString {
    // XXX idea: would it make code simpler if I had offset/length in order to
    // make slices?

    constructor(codepoints) {
        this.codepoints = codepoints || (new Uint32Array());
        // TODO rgb, last modified ts/user, source locs
    }

    get_length() { return this.codepoints.length; }
    set_length(n) {
        this.codepoints = resize_typed_array(this.codepoints, n);
        // TODO rgb, last modified ts/user, ...?
    }

    codepoint_at(index) { return this.codepoints[index]; }
         char_at(index) { return String.fromCodePoint(this.codepoint_at(index)); }

    substring(i0,i1) {
        return new this.constructor(
            this.codepoints.subarray(i0,i1)
        );
    }

    has_codepoints_at(codepoints, index) {
        const n = codepoints.length;
        for (let i=0; i<n; ++i) if (this.codepoints[index+i] !== codepoints[i]) return false;
        return true;
    }
    
    to_string() {
        // XXX I wonder what is the best way of converting a Uint32Array of
        // codepoints to a string? TextDecoder doesn't support UTF-32, and
        // string concatenation seems to suffer from O(n²) issues. some people
        // suggest join is efficient enough? I suspect UTF-32 => UTF-8 =>
        // TextDecoder might perform better? :) (with custom UTF-32=>UTF-8
        // encoder). or UTF-32 => UTF-16? But MDN calls utf-16 support
        // "legacy".
        return [...this.codepoints.values()].map(c=>String.fromCodePoint(c)).join("");
    }
}

// klejne kode tokenizer:
// Usage: make_tokenizer_maker(setup OR undef) => tokenizer_maker   (setup defaults to DEFAULT_TOKENIZER_SETUP)
//                 tokenizer_maker(fat string) => tokenizer
//                                 tokenizer() => next token OR null
const make_tokenizer_maker = (_=>{
    const punctuation_arr = ["mix","chain","directive","assignment"];
    const sigils_arr      = ["variable_sigil","macro_sigil"];
    const digit_range = string_to_codepoints("09");
    const minus_sign  = string_to_codepoints("-");

    function match_fat_substring_codepoints_rec(fat_string, index, def, accept, depth) {
        const n = def.length;
        if (n === 0) return null;
        if (typeof def[0] === "number") return fat_string.has_codepoints_at(def, index) ? [] : null;
        let r = null;
        for (let i=0; i<def.length; ++i) {
            let subdef = def[i];
            let m = match_fat_substring_codepoints_rec(fat_string, index, subdef, accept, (depth||0)+1);
            if (m && (!accept || accept(depth,i))) {
                if (r !== null) throw new Error("multiple punctuation matches: bad tokenizer setup? def=" + JSON.stringify(def));
                r = [i, ...m];
            }
        }
        return r;
    };

    UNIT_TEST(_=>{
        const m0=string_to_codepoints("."), m1=string_to_codepoints(".."), m2=string_to_codepoints("...");
        const fs = new FatString(string_to_codepoints(".:.."));
        const trials = [
            [0,m0,[]], [0,m1,null], [2,m1,[]], [1,m0,null],
            [0,[m0],[0]], [0,[[42],m0],[1]],
            [0,[[m0]],[0,0]], [0,[[42],[m0]],[1,0]], [0,[[42],[[1,2],m0]],[1,1]],
            [1,[[m0]],null],  [1,[[42],[m0]],null],  [1,[[42],[[1,2],m0]],null],
            [2,[[m0]],[0,0]], [2,[[42],[m0]],[1,0]], [2,[[42],[[1,2],m0]],[1,1]],
            [2,[[m1]],[0,0]], [2,[[42],[m1]],[1,0]], [2,[[42],[[1,2],m1]],[1,1]],
            [2,[[m2]],null],  [2,[[42],[m2]],null],  [2,[[42],[[1,2],m2]],null],
        ];
        for (const [index, match, expected_match_result] of trials) ASSERT_SAME_REPR(match_fat_substring_codepoints_rec(fs,index,match), expected_match_result);
    });

    const lookup = (nested_arrays, indices) => indices.length === 0 ? nested_arrays : lookup(nested_arrays[indices[0]], indices.slice(1));
    UNIT_TEST(_=> {
        const trials = [
            [42,[],42],
            [[1,42],[0],1], [[1,42],[1],42],
            [[1,[2,42]],[1,0],2], [[1,[2,42]],[1,1],42],
        ];
        for (const [nested_arrays, indices, expected_lookup_result] of trials) ASSERT_SAME_REPR(lookup(nested_arrays, indices), expected_lookup_result);
    });

    return /* make_tokenizer_maker= */ (setup) => {
        if (setup === undefined) setup = DEFAULT_TOKENIZER_SETUP;

        // map setup strings thru string_to_codepoints()
        let setup_codepoints = {};
        for (const key in setup) {
            function maprec(v) {
                if (typeof v === "string") return string_to_codepoints(v);
                if (v instanceof Array)    return v.map(maprec);
                throw new Error("invalid input: " + JSON.stringify(v));
            };
            setup_codepoints[key] = maprec(setup[key]);
        }

        return /* tokenizer_maker= */ (fat_string) => {
            let cursor = 0;
            let line = 1;
            let line_cursor0 = cursor;

            const match_codepoints = (def, accept) => match_fat_substring_codepoints_rec(fat_string, cursor, def, accept);

            const has_more = () => (cursor < fat_string.get_length());

            function skip_whitespace() {
                const c0 = cursor;
                for (;;++cursor) {
                    const c = fat_string.codepoint_at(cursor)
                    if (setup_codepoints.whitespace.indexOf(c) >= 0) continue;
                    if (c === setup_codepoints.newline[0]) {
                        ++line;
                        line_cursor0 = cursor+1;
                        continue;
                    }
                    return cursor>c0;
                }
            }

            function skip_comment() {
                if (!match_codepoints(setup_codepoints.comment)) return false;
                while (has_more() && !match_codepoints(setup_codepoints.newline)) ++cursor;
                ++line;
                return true;
            }

            return /* tokenizer= */ () => {
                for (;;) {
                    if (!has_more()) return null;
                    if (skip_whitespace()) continue;
                    if (skip_comment()) continue;
                    break;
                }

                const cursor0 = cursor;
                const token_rest = () => ({
                    string: fat_string.substring(cursor0, cursor),
                    line,
                    col: (1+cursor0-line_cursor0),
                });
                let get_codepoint = () => fat_string.codepoint_at(cursor);

                
                { // try matching parenthesis
                    const def = setup_codepoints.parenthesis;
                    let p = match_codepoints(def);
                    if (p) {
                        ASSERT(p.length === 2 && (p[1]===0 || p[1]===1));
                        cursor += lookup(def, p).length;
                        return { type:"parenthesis", shape:p[0], open:p[1]===0, close:p[1]===1, ...token_rest() };
                    }
                }

                for (const name of punctuation_arr) { // try matching punctuation
                    const def = setup_codepoints[name]; ASSERT(def);
                    let p = match_codepoints(def);
                    if (p) {
                        // XXX TODO:
                        cursor += lookup(def, p).length;
                        return { type:name, ...token_rest() };
                    }
                }

                for (const name of ["string","javascript_string"]) { // try matching strings
                    const def = setup_codepoints[name];
                    // NOTE the (depth,index) "accept" function ensures we only
                    // match string-begin chars. this prevents an internal
                    // error with the default setup where both »foo« and «bar»
                    // are valid strings (without the accept function it
                    // complains about multiple matches)
                    let p0 = match_codepoints(def, (depth,index) => ((depth!==1) || (index===0)));
                    if (p0) {
                        ASSERT(p0.length === 0 || p0.length === 1 || (p0.length === 2 && p0[1]===0), "unexpected structure");
                        if (p0.length === 2) p0[1] = 1; // match opposite
                        const m = lookup(def, p0);
                        cursor += m.length;
                        for (;;) {
                            if (!has_more()) throw new Error("unterminated string");
                            let p1 = match_codepoints(m);
                            if (p1) {
                                cursor += m.length;
                                // TODO if type==="string" I need to return a
                                // "magic string"? also the string body should
                                // be available for both types?
                                return { type:name, ...token_rest() };
                            } else {
                                ++cursor;
                            }
                        }
                    }
                }

                // subtlety ahead: we're matching numbers /before/ identifiers.
                // this is because 0-9 are identifier chars (in the default setup).

                for (;;) { // try matching number
                    const cp = get_codepoint();
                    if (cursor === cursor0 && cp === minus_sign[0]) { ++cursor; continue; }
                    if (digit_range[0] <= cp && cp <= digit_range[1])  { ++cursor; continue; }
                    if (cp === setup_codepoints.number_decimal) { ++cursor; continue; } // XXX conflict with "chain" operator?
                    if (cursor > cursor0) return { type:"number", ...token_rest() };
                    break;
                }

                let sigil = null;
                for (const name of sigils_arr) { // try matching sigils
                    const def = setup_codepoints[name];
                    let p = match_codepoints(def);
                    if (p) {
                        cursor += lookup(def, p).length;
                        ASSERT(sigil===null);
                        sigil = name;
                        skip_whitespace(); // "@foo" and "@ foo" are the same
                    }
                }

                const idcursor0 = cursor;
                for (;;) { // try matching identifier
                    let match = false;
                    const c = fat_string.codepoint_at(cursor);
                    const cp = get_codepoint();
                    for (let d of setup_codepoints.identifier_chars) {
                        if ((d.length === 1 && d[0] === cp) || ((d.length === 2) && (d[0] <= cp && cp <= d[1]))) {
                            match = true;
                            break;
                        }
                    }
                    if (match) {
                        ++cursor;
                    } else if (cursor === cursor0) {
                        break;
                    } else if (cursor > cursor0) {
                        const identifier = fat_string.substring(idcursor0, cursor).to_string();
                        return { type:"identifier", sigil, identifier, ...token_rest() };
                    } else {
                        throw new Error("unreachable");
                    }
                }

                ++cursor;
                return {type:"error", ...token_rest()};
            }
        };
    };
})();


//const T = make_tokenizer_maker()(new FatString(string_to_codepoints("=foo 42 .. bar ({ # 3*3 # } xxx) .. baz \"bd*4\" 'sd*2' «hh*16» »cb(5,16)« 69 -- ignore this comment!@#$%^&*()--..")));
const T = make_tokenizer_maker()(new FatString(string_to_codepoints("foo < $bar > *quux ‹ foo ›    :: : foo @@foo")));
for (;;) {
    //let [t,e] = T();
    //if (e) throw e;
    let t = T();
    if (!t) break;
    console.log("token", t);
}
