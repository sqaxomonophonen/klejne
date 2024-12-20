export class Memory {
	constructor(initial_64k_page_count) {
		if (!initial_64k_page_count || initial_64k_page_count<2) initial_64k_page_count = 2;
		this._mem = new WebAssembly.Memory({ initial: initial_64k_page_count });
	}

	get_env_mem() { return this._mem; }

	grow(num_64k_pages) {
		const sz0 = this._mem.buffer.byteLength;
		if (num_64k_pages <= 0) return sz0;
		this._mem.grow(num_64k_pages);
		const sz1 = this._mem.buffer.byteLength;
		console.info(`wasm grow :: ${num_64k_pages}×64kB :: ${sz0}B -> ${sz1}B`);
		return sz1;
	}

	// unsafe_TYPEarr(base,n) returns an TypedArray view of the wasm memory;
	// type is determined by TYPE; `base` is the address of the first element
	// (in bytes); `n` is the length of the array. RE: "unsafe": if grow() is
	// called, the underlying ArrayBuffer of all views are /detached/; this
	// invalidates the view! it leads to bad bugs that are somewhat similar to
	// realloc()-bugs in C; the kind where you have pointers lying around that
	// occassionally get invalidated because realloc() returns a new pointer.
	// (XXX the underlying ArrayBuffer has a `detached` field that becomes
	// `true` when this happens; I'm unsure if this implies it actually makes
	// sense to "cache" the TypedArray? currently I'm assuming these views are
	// basically free to construct like in C)
	unsafe_u8arr(base,  n) { return new Uint8Array(this._mem.buffer, base, n); }
	unsafe_i8arr(base,  n) { return new Int8Array(this._mem.buffer, base, n); }
	unsafe_f32arr(base, n) { return new Float32Array(this._mem.buffer, base, n); }
	unsafe_u32arr(base, n) { return new Uint32Array(this._mem.buffer, base, n); }
	unsafe_i32arr(base, n) { return new Int32Array(this._mem.buffer, base, n); }

	get_f32(base,index)       { return this.unsafe_f32arr(base)[index]; }
	set_f32(base,index,value) { this.unsafe_f32arr(base)[index] = value; }

	// extract zero-terminated C string at `pointer` to UTF-8 string
	get_cstr(pointer) {
		const msg = this.unsafe_u8arr(pointer);
		let len=0;
		while (msg[len] !== 0) len++;
		return (new TextDecoder()).decode(msg.slice(0,len));
	}
}
