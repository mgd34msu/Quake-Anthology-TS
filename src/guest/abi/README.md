# Guest calling conventions

`X86AbiAdapter` marshals calls over the existing `GuestCpu`, `GuestProcessorState`, and `MappedGuestMemory`. It implements `GuestAbiAdapter`. The adapter does not load images, execute a second CPU, invoke native code, or initialize an operating-system runtime.

`planGuestCall(signature, layouts?)` exposes the source register and stack locations. `enter` writes a real guest return address, argument slots, shadow space, and aligned aggregate temporaries beneath the supplied stack pointer. `arguments` reads a trapped host callback's entry state. `leave` writes the result and performs the convention's guest return. `returnValue` reads a completed guest result and consumes an i386 x87 return slot.

The supported conventions are Windows i386 `cdecl`, `stdcall`, `fastcall`, and `thiscall`; Windows x64; and System V i386 and x86-64. Variadic Win32 calls use caller cleanup and stack arguments. Microsoft x64 follows positional integer/XMM assignments and reserves 32 bytes of shadow space. System V x64 allocates integer and SSE arguments independently, rolls back aggregate register assignment when a whole argument will not fit, and passes the vector-register count in AL for variadics.

Aggregate classification uses `GuestLayout`'s explicit scalar fields and offsets, including repeated and overlapping union fields. Bytes remain authoritative rather than becoming reshaped JavaScript records. This contract describes POD aggregates in C, global functions, and static member functions. Win32 `thiscall` explicitly uses a hidden buffer for every aggregate return, including small POD records. Other C++ member-function signatures must expose their hidden parameters explicitly because `NativeCallAbi` does not identify nonstatic x64 methods. Nontrivial C++ object passing, native vector types, long-double argument layouts, vectorcall, and AVX arguments need additional explicit layout kinds before they can be classified. They are not inferred from aggregate size.

## Call runner

`GuestCallRunner` takes `{ cpu, callbacks, returnAddress, variadicLayouts? }`. Its `invoke` request contains `{ target, signature, arguments, context, instructionBudget }` and returns `GuestCallResult` synchronously. The return address is a caller-owned executable trap or sentinel in the same guest memory. CPU host-call predicates must recognize the bound callback addresses before fetching their trap bytes.

The runner handles real CPU host-call stops through `GuestCallbackTable`, then resumes the same CPU after `leave`. Nested invocations restore their enclosing processor context on success while keeping guest memory mutations. Successful outer calls reclaim their caller-owned stack and instruction pointer; other guest register and floating-point state remain authoritative. The runner checks the actual return stack pointer against the convention's cleanup rule.

The signature contains fixed parameters. Trailing call values receive default variadic floating promotion. A host variadic API provides the promoted trailing layouts through `variadicLayouts`, usually after its own format-string parsing. The ABI layer does not guess argument count or types from stack bytes. Guest function prologues own their register-save areas and `va_list` initialization.

Nested guest instructions debit every enclosing call budget. Host callback dispatch also consumes a step. A budget, exception, halt, or unsupported instruction raises `GuestCallStopped` with the actual CPU stop and call context. The faulting processor and memory remain available to the runtime. The runner does not simulate a successful return or invent an exception unwind.

`captureAbiProcessorState` and `restoreAbiProcessorState` preserve raw register, flag, segment, x87, and SIMD state. `SparseGuestMemory` and `GuestCallbackTable` retain their existing checkpoint formats and rebind saved callback offsets into the restored address space. Save boundaries occur outside an active synchronous host callback; a JavaScript callback continuation is not a serializable guest stack. Unload and reload use the callback table's explicit unbind and bind operations.

## Validation and sources

`bun test tests/guest/abi` checks documented register/stack fixtures and authored machine-code calls through the real i386 and x64 interpreters. Tests cover all four ABI families, nested callbacks and shared memory, saved callback rebinding, stale-address rejection, exception-frame retention, aggregate byte preservation, variadics, subword argument widening, x87 returns, and actual `ret imm16` cleanup. These checks do not establish native game-module compatibility.

The calling rules follow these primary sources:

- [Microsoft x64 calling convention](https://learn.microsoft.com/en-us/cpp/build/x64-calling-convention?view=msvc-170).
- [Microsoft argument passing and naming conventions](https://learn.microsoft.com/en-us/cpp/cpp/argument-passing-and-naming-conventions?view=msvc-170), [fastcall](https://learn.microsoft.com/en-us/cpp/cpp/fastcall?view=msvc-170), and [thiscall](https://learn.microsoft.com/en-us/cpp/cpp/thiscall?view=msvc-170).
- [LLVM's MSVC-compatible thiscall struct-return fixture](https://raw.githubusercontent.com/llvm/llvm-project/main/clang/test/CodeGenCXX/thiscall-struct-return.cpp).
- [System V x86-64 processor supplement source](https://gitlab.com/x86-psABIs/x86-64-ABI/-/raw/master/x86-64-ABI/low-level-sys-info.tex), parameter classification and return sections.
- [System V i386 processor supplement source](https://gitlab.com/x86-psABIs/i386-ABI/-/raw/master/low-level-sys-info.tex), parameter passing and aggregate-return sections.
