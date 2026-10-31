// テスト用: Web Locks API の最小の偽物(ifAvailable と steal だけ。本物の挙動はブラウザで確認すること)
export function createFakeLocks() {
  let holder = null;
  return {
    request(name, options, callback) {
      if (options.steal) {
        if (holder) { holder.abort(); holder = null; }
      } else if (holder) {
        if (options.ifAvailable) return Promise.resolve(callback(null));
        throw new Error("fake: 待ち行列は未対応");
      }
      return new Promise((resolve, reject) => {
        const me = { abort: () => reject(Object.assign(new Error("stolen"), { name: "AbortError" })) };
        holder = me;
        Promise.resolve(callback({ name })).then(
          (v) => { if (holder === me) holder = null; resolve(v); },
          (e) => { if (holder === me) holder = null; reject(e); },
        );
      });
    },
  };
}
