// wasm helpers and things

#include <stddef.h>
#include <stdint.h>
#include <wasm_simd128.h>

#define NO_RETURN     __attribute__((noreturn))
//#define PLEASE_EXPORT __attribute__((used))
#define PLEASE_EXPORT __attribute__((visibility("default")))

static inline size_t our_strlen(const char* s)
{
	size_t len = 0;
	while (*(s++)) len++;
	return len;
}

static inline void* our_memcpy(void* dst, const void* src, size_t n) { return __builtin_memcpy(dst, src, n); }

// /////////////////////////////////
// MESSAGE
// a way to send a message back to JavaScript
// /////////////////////////////////

static int message_cursor;
static char message[1<<14];

PLEASE_EXPORT const char* get_message(void)
{
	return message;
}

static void reset_message(void)
{
	message[0] = 0;
	message_cursor = 0;
}

static void append_to_message(const char* string)
{
	const size_t n = our_strlen(string);
	const size_t remaining = (sizeof(message)-1) - message_cursor;
	const size_t can_write = n > remaining ? remaining : n;
	our_memcpy(message + message_cursor, string, can_write);
	message_cursor += can_write;
	message[message_cursor] = 0;
}

// /////////////////////////////////
// ASSERT
// /////////////////////////////////

NO_RETURN static void handle_failed_assertion(const char* failed_predicate, const char* location)
{
	reset_message();
	append_to_message("ASSERTION FAILED {{{ ");
	append_to_message(failed_predicate);
	append_to_message(" }}} at ");
	append_to_message(location);
	__builtin_trap(); // stops and throws WebAssembly.RuntimeError
}

#define STR2(s) #s
#define STR(s) STR2(s)
#define assert(p) if (!(p)) handle_failed_assertion(#p, __FILE__ ":" STR(__LINE__))

// /////////////////////////////////
// HEAP
// /////////////////////////////////

extern unsigned char __heap_base;
static size_t heap_bytes_allocated;
static size_t mem_size;
extern size_t js_grow_memory(size_t); // implemented in JS

static void heap_reset(void)
{
	heap_bytes_allocated = 0;
}

static void heap_grow_64k(size_t delta_64k_pages)
{
	mem_size = js_grow_memory(delta_64k_pages);
	assert(mem_size > 0);
}

static size_t get_mem_size(void)
{
	if (mem_size == 0) heap_grow_64k(0);
	assert(mem_size > 0);
	return mem_size;
}

#define ALIGN_LOG2(lg2,x)    (((x)+(1<<lg2)-1) & ~((1<<lg2)-1))
#define HEAP_ALIGNMENT_LOG2  (4)
#define HEAP_ALIGN(x)        ALIGN_LOG2(HEAP_ALIGNMENT_LOG2,x)

static void* heap_alloc(size_t n)
{
	n = HEAP_ALIGN(n);
	void* base = (void*)(HEAP_ALIGN((intptr_t)&__heap_base) + heap_bytes_allocated);
	intptr_t end = (intptr_t)base + n;
	intptr_t needed = end - get_mem_size();
	if (needed > 0) heap_grow_64k(ALIGN_LOG2(16,needed) >> 16);
	assert(end <= get_mem_size());
	heap_bytes_allocated += n;
	return base;
}

#define STBIRDEF PLEASE_EXPORT
#define STBIR_ASSERT(p) assert(p)
#define STBIR_MALLOC(size,user_data)    heap_alloc(size)
#define STBIR_FREE(ptr,user_data)
#define STB_IMAGE_RESIZE_IMPLEMENTATION
#include "stb_image_resize2.h"

PLEASE_EXPORT void selftest_assertion_failure(void)
{
	assert((4==5) && "this expression is false");
}
