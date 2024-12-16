import { tokenizer, tokTypes } from './acorn/index.js';
export default function tokenize(src) {
	const tt = tokenizer(src);
	let tokens = [];
	for (;;) {
		const tok = tt.getToken();
		if (tok.type === tokTypes.eof) break;
		tokens.push(tok);
	}
	return tokens;
}
