"use strict"

class WasmApp
{
  constructor()
  {
    this.memory = null;
    this.HEAPU32 = null;
    this.resources = {};
  }

  load()
  {
    const WASM_PAGE_SIZE = 65536;
    const TOTAL_MEMORY = 65536;
    const DYNAMICTOP_PTR = 11856;

    const abort = (what) => { throw new Error('abort(' + what + '). Build with -s ASSERTIONS=1 for more info.'); };
    const env = {
      "abort": () => abort(1),
      "_abort": () => abort(2),
      "__assert_fail": (condition, filename, line, func) =>
        abort('Assertion failed: ' + env.string(condition) + ', at: ' + [filename ? env.string(filename) : 'unknown filename', line, func ? env.string(func) : 'unknown function']),
      "__setErrNo": () => abort(3),
      "emscripten_get_heap_size": () => abort(4),
      "emscripten_memcpy_big": (dest, src, num) => this.memory.copyWithin(dest, src, src + num),
      "emscripten_memcpy_js": (dest, src, num) => this.memory.copyWithin(dest, src, src + num),
      "emscripten_resize_heap": () => abort(6),
      "abortOnCannotGrowMemory": () => abort(7),
      "DYNAMICTOP_PTR": DYNAMICTOP_PTR,
      memory: new WebAssembly.Memory({ 'initial': TOTAL_MEMORY / WASM_PAGE_SIZE, 'maximum': TOTAL_MEMORY / WASM_PAGE_SIZE }),
      table: new WebAssembly.Table({'initial': 84,'maximum': 84,'element': 'anyfunc'}),
      '__memory_base': 1024,
      '__table_base': 0
    };

    const localImports = this.imports();
    for (const i in localImports)
      env[i] = localImports[i];

    // apiRead is a synchronous WASM import, so any resource it might need must be
    // fetched up front - can't fetch lazily from inside the import call.
    return Promise.all([
      fetch("/assets/tunneler.wasm").then(r => r.arrayBuffer()),
      fetch("/assets/TUNNELER.EXE").then(r => r.arrayBuffer()).then(buf => { this.resources["TUNNELER.EXE"] = new Uint8Array(buf); })
    ])
    .then(([wasmBuf]) => WebAssembly.instantiate(new Uint8Array(wasmBuf), {env: env, wasi_snapshot_preview1: env}))
    .then( output =>
    {
      this.symbols = output.instance.exports;
      this.memory = new Uint8Array(this.symbols.memory.buffer);
      this.HEAP32 = new Int32Array(this.symbols.memory.buffer);
      if (this.symbols["__wasm_call_ctors"])
        this.symbols["__wasm_call_ctors"]();
    });
  }

  imports()
  {
    return {
      apiPrint: (ptr) => {
        const msg = this.imports().string(ptr);
        console.log(msg);
      },
      string: (ptr) => {
        let text = "";
        for (let i=0; i<50 && this.memory[ptr+i] != 0; i++)
          text += String.fromCharCode(this.memory[ptr+i]);
        return text;
      },
      apiRead: (ptrName, readOfs, readLen, ptrData) =>
      {
        const name = this.imports().string(ptrName);
        const b = this.resources[name];
        const willRead = Math.min(b.length-readOfs, readLen);
        for (let i=0; i<readLen; i++)
          this.memory[i+ptrData] = b[i+readOfs];
        return willRead;
      },
      // https://gov.near.org/t/discussion-synchronous-contracts/11869/8
      emscripten_sleep: () => {
          if (!this.rewinding)
          {
            const ptr = this.symbols.asyncifyBuffer.value;
            this.HEAP32[((ptr)>>2)] = ptr+12;
            this.HEAP32[(((ptr)+(4))>>2)] = ptr+12 + 1024;
            this.HEAP32[(((ptr)+(8))>>2)] = 0;
            this.symbols.asyncify_start_unwind(ptr);
          } else {
            this.symbols.asyncify_stop_rewind();
            this.rewinding = false;
            return 0;
          }
      },
      fd_close: () => { throw new Error("close"); },
      fd_write: (handle, x, y, ptr) => { throw new Error("write"); },
      fd_seek: () => { throw new Error("seek"); }
    }
  }
  asyncifyResume()
  {
    const ptr = this.symbols.asyncifyBuffer.value;
    this.rewinding = true;

    this.symbols.asyncify_start_rewind(ptr);
    this.symbols.appLoop();
    this.symbols.asyncify_stop_unwind();
  }
}
