let panic_handlers = [];
export function add_panic_handler(handler) {
	panic_handlers.push(handler);
}

// hack that presently works on chrome/firefox. it depends on:
//  - "stack" containing a "\n"-separated list of stack entries, top first
//  - one line containing "caller", and it being sufficiently unique
// if "caller" is not found, the original string is returned
function trim_stack_hack(stack, caller, n)  {
	const orig_stack = stack;
	stack = stack.split("\n");
	while (stack.length) {
		if (stack[0].indexOf(caller) >= 0) {
			return stack.slice(n).join("\n");
		}
		stack.shift();
	}
	return orig_stack;
}

function _call_panic_handlers(reason, msg, stack) {
	for (let h of panic_handlers) h(reason, msg, stack);
}

function _raw_panic(reason, msg, n_trim_stack) {
	const err = new Error(reason + (msg ? (" :: " + msg) : ""));
	_call_panic_handlers(reason, msg, trim_stack_hack(err.stack,"_raw_panic",n_trim_stack));
	throw err;
}

export function assert(p,msg) {
	if (p) return;
	_raw_panic("ASSERTION FAILED", msg, 2)
}

export function panic(msg) {
	_raw_panic("PANIC", msg, 2);
}

export function uncaught(error) {
	if (!error) {
		_call_panic_handlers("NIL ERROR", "", "");
	} else if (error.message && error.stack) {
		_call_panic_handlers("UNCAUGHT EXCEPTION", error.message, error.stack);
	} else {
		_call_panic_handlers("UNCAUGHT ERROR", ""+error, "<no stack>");
	}
}

// gaussian bell curve at x for variance v and mean=0
export const gaussian = (v,x) => Math.exp(-(x*x)/(2*v*v)) / Math.sqrt(2*Math.PI*v*v);

// constructor returns a function that you must call every frame; every 1000
// milliseconds (overridable default) it returns the current FPS (frames per
// second), and returns null the rest of the time.
export const make_fps_counter = (every_milliseconds) => {
	if (every_milliseconds === undefined) every_milliseconds = 1000;
	let t0 = null;
	let counter = 0;
	return () => {
		if (t0 === null) t0 = Date.now();
		counter++;
		const dt = Date.now() - t0;
		if (dt >= every_milliseconds) {
			const fps = (counter*dt*(1000/every_milliseconds)) / every_milliseconds;
			counter = 0;
			t0 = Date.now();
			return fps;
		}
		return null;
	};
}
