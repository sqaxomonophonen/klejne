export function get_cstr(memory, pointer) {
	const msg = new Uint8Array(memory, pointer);
	let len=0;
	while (msg[len] !== 0) len++;
	return (new TextDecoder()).decode(msg.slice(0,len));
}
