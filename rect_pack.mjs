function ASSERT(p) { if (!p) throw new Error("ASSERT FAILED (in rect_pack.mjs)"); }
const DEBUG = true; // XXX change to false at some point?

// JS implementation of "&" in C I guess :-)
class GettySetty {
	constructor(obj, field) {
		this.obj = obj;
		this.field = field;
	}

	get() {
		return this.obj[this.field];
	}

	set(new_value) {
		this.obj[this.field] = new_value;
	}

}

export default class RectPack {
	constructor(width, height, num_nodes) {
		this.nodes = [];
		for (let i=0; i < num_nodes  ; ++i) this.nodes[i] = {x:0,y:0,next:null};
		for (let i=0; i < num_nodes-1; ++i) this.nodes[i].next = this.nodes[i+1];
		this.free_head = this.nodes[0];
		this.extra = [null,null];
		this.extra[1] = {
			x:width, y:null,
			next:null,
		};
		this.extra[0] = {
			x:0, y:0,
			next:this.extra[1],
		};
		this.active_head = this.extra[0];
		this.width = width;
		this.height = height;
		this.num_nodes = num_nodes;
	}

	_skyline_find_min_y(first, x0, width) {
		let node = first;
		const x1 = x0+width;
		ASSERT(first.x <= x0);
		ASSERT(node.next.x > x0);
		ASSERT(node.x <= x0);
		let min_y=0;
		while (node.x < x1) {
			ASSERT(node.y !== null);
			if (node.y > min_y) min_y = node.y;
			node = node.next;
		}
		return min_y;
	}

	_skyline_find_best_pos(width, height) {
		let best_y=null;

		// if it can't possibly fit, bail immediately
		if (width > this.width || height > this.height) return {prev_link:null};

		let node = this.active_head;
		let prev = new GettySetty(this, "active_head");
		let best = null;
		while ((node.x + width) <= this.width) {
			const y = this._skyline_find_min_y(node, node.x, width);
			if (best_y === null || y < best_y) {
				best_y = y;
				best = prev;
			}
			prev = new GettySetty(node, "next");
			node = node.next;
		}
		let best_x = (best === null) ? 0 : best.get().x;

		return { prev_link:best, x:best_x, y:best_y };
	}

	_skyline_pack_rectangle(width, height) {
		const res = this._skyline_find_best_pos(width, height);
		if (res.prev_link === null || res.y+height > this.height || this.free_head === null) {
			res.prev_link = null;
			return res;
		}

		let node = this.free_head;
		node.x = res.x;
		node.y = (res.y + height);
		this.free_head = node.next;

		// insert the new node into the right starting point, and
		// let 'cur' point to the remaining nodes needing to be
		// stiched back in

		let cur = res.prev_link.get();
		if (cur.x < res.x) {
			let next = cur.next;
			cur.next = node;
			cur = next;
		} else {
			res.prev_link.set(node);
		}

		// from here, traverse cur and free the nodes, until we get to one
		// that shouldn't be freed
		while (cur.next && cur.next.x <= res.x + width) {
			let next = cur.next;
			// move the current node to the free list
			cur.next = this.free_head;
			this.free_head = cur;
			cur = next;
		}

		// stitch the list back in
		node.next = cur;

		if (cur.x < res.x + width) {
			cur.x = (res.x + width);
		}

		if (DEBUG) {
			cur = this.active_head;
			while (cur.x < this.width) {
				ASSERT(cur.x < cur.next.x);
				cur = cur.next;
			}
			ASSERT(cur.next === null);
			{
				let count=0;
				cur = this.active_head;
				while (cur) {
					cur = cur.next;
					++count;
				}
				cur = this.free_head;
				while (cur) {
					cur = cur.next;
					++count;
				}
				ASSERT(count === this.num_nodes+2);
			}
		}

		return res;
	}

	pack(rects) {
		const num_rects = rects.length;

		// we use the 'was_packed' field internally to allow
		// sorting/unsorting
		for (let i=0; i < num_rects; ++i) rects[i].was_packed = i;

		// sort according to heuristic
		rects.sort((a,b) => ((a.h>b.h)?-1:(a.h<b.h)?1:(a.w>b.w)?-1:(a.w<b.w)?1:0));

		for (let r of rects) {
			if (r.w === 0 || r.h === 0) {
				r.x = r.y = 0;  // empty rect needs no space
			} else {
				const fr = this._skyline_pack_rectangle(r.w, r.h);
				if (fr.prev_link) {
					r.x = fr.x;
					r.y = fr.y;
				} else {
					r.x = r.y = null;
				}
			}
		}

		// unsort (restore original order)
		rects.sort((a,b) => (a.was_packed - b.was_packed));

		let all_rects_packed = true;
		for (let r of rects) {
			r.was_packed = (r.x !== null && r.y !== null);
			if (!r.was_packed) all_rects_packed = false;
		}
		return all_rects_packed;
	}
}

/*
===============================================================================
Original in C by: Sean T. Barrett, https://github.com/nothings/stb/blob/master/stb_rect_pack.h
Port to JavaScript by: Anders Kaare Straadt
===============================================================================
Public Domain (www.unlicense.org)
This is free and unencumbered software released into the public domain.
Anyone is free to copy, modify, publish, use, compile, sell, or distribute this
software, either in source code form or as a compiled binary, for any purpose,
commercial or non-commercial, and by any means.
In jurisdictions that recognize copyright laws, the author or authors of this
software dedicate any and all copyright interest in the software to the public
domain. We make this dedication for the benefit of the public at large and to
the detriment of our heirs and successors. We intend this dedication to be an
overt act of relinquishment in perpetuity of all present and future rights to
this software under copyright law.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN
ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
===============================================================================
*/
