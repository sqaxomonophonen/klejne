// another 100 lines of code that should not have to exist; see the long
// "innerHTML rant" below.

import { assert, panic } from "./util.mjs";

export default class WebGL2CanvasUnfuck {
	constructor(setup_fn) {
		this.setup_fn = setup_fn;
		this.have_context = false;
	}

	im_sorry(sorry) {
		// sorry style
		sorry.style.background = "black";
		sorry.style.color = "#ff0";
		sorry.style.border = "1px dashed #ff0";
		sorry.style.padding = "0.5em";
		sorry.style.fontSize = "0.6em";
		sorry.style.fontFamily = "serif"; // serif for /serious/ business
		this.root_element.appendChild(sorry);
		this.sorry = sorry;
	}

	mount(root_element) {
		assert(!this.root_element, "already mounted");
		this.root_element = root_element;
		this.canvas = document.createElement("canvas");
		this.root_element.appendChild(this.canvas);
		this.gl = this.canvas.getContext("webgl2");
		if (this.gl === null) {
			// XXX TODO make "sorry" message for this too maybe?
			panic("failed to get webgl2 context");
		}
		this.have_context = true;
		this.sorry = null;
		this.canvas.addEventListener("webglcontextlost", () => {
			this.root_element.removeChild(this.canvas);
			this.canvas = null;
			this.gl = null;
			this.have_context = true;

			const /* constantly sorry */ sorry = document.createElement("div");

			const p0 = document.createElement("p0");
			p0.innerHTML = `
			SORRY! WE LOST A WEBGL2 CONTEXT! Also sorry if you have no idea
			what that means! I almost don't know what it means anymore because
			Google is using it in a new <em title="he he">context</em>!
			It means that something went wrong with something
			that draws things! At the <em title="2024-12-21">time of
			writing</em> Chrome likes to "lose" webgl2 contexts if it
			thinks you have too many. That limit is currently <em>16</em>.
			Note that Chrome doesn't address any <em>real</em> problem here
			because I've seen Firefox easily handle 100+ contexts. Also note
			that Firefox and Chrome use the same
			<em title="Google's ANGLE">webgl implementation</em>.
			It may be possible to raise the limit with the
			<tt>--max-active-webgl-contexts</tt> command-line switch &mdash; but who
			knows &mdash; because it's <em>not part of the HTML5 standard</em>, so
			Google have no obligations here;
			<em title="i mean thats generally true isnt it">they can do what they want!</em>
			This is also the real reason why I'm writing long messages instead
			of "just solving the problem" because
			<em title="and all the sarcasm">this</em> is the best solution I
			could come up with! You can try pressing the following button to
			create the context anew but it <em title="just like this one">may
			end up destroying another context.</em>
			`;
			// Addendum: bad solutions considered, and deemed even worse:
			// - "why not create the context automatically again?". it's really
			//   obvious, but in case you've missed it: /creating/ a context
			//   may cause another one to be destroyed; your suggestion is to
			//   create an infinite loop that crashes the app.
			// - "why not have a maximum number of contexts?"
			//   - there's no way to read what the context limit is; it's not
			//     part of any standard.
			//   - chrome seemingly allows changing the limit on the
			//     command-line; I don't want to prevent people from solving
			//     the problem in their own way.
			//   - it has to be "bubbled" all the way up to the UI; /anything/
			//     that may want to create a context now has to consider the
			//     possibility that we already have too many contexts. this has
			//     to be communicated via.. disabled buttons.. helpful texts..
			//     and so on. it's a lot more work for something that doesn't
			//     really solve anything anyway.
			//   - not being standardized it may change without any notice.
			//     yes I'd love to throw this file the hell out of the window,
			//     and so I also prefer not wasting ungodly amount of time on
			//     it.
			// - "how about a /configurable/ maximum number of contexts?"
			//   - should Firefox users be able to configure it too? and why?
			//   - basically it's a slightly nicer version of the previous
			//     solution, and even more work.
			//   - what problem are we trying to solve here? loss of context is
			//     an annoyance at best and a badly timed inconvenience at
			//     worst? we're (hopefully) not talking loss of data or
			//     anything like that.
			sorry.appendChild(p0);

			const button = document.createElement("button");
			button.innerText = "MAKE CONTEXT CREATE AGAIN!!1";
			button.title = "...and possibly destroy another one! #pray";
			button.onclick = () => {
				this.remount();
			};
			sorry.appendChild(button);

			// i said im sorry ok
			this.im_sorry(sorry);
		});

		this.setup_fn(this);
	}

	unmount() {
		assert(this.root_element !== null, "not mounted");
		if (this.sorry) {
			this.root_element.removeChild(this.sorry);
		} else {
			assert(this.canvas);
			this.root_element.removeChild(this.canvas);
		}
		this.gl = null;
		this.canvas = null;
		this.sorry = null;
		this.root_element = null;
		this.have_context = true;
	}

	remount() {
		const root = this.root_element;
		assert(root !== null, "not mounted");
		this.unmount();
		this.mount(root);
	}
}
