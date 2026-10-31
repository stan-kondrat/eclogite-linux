// Preloaded with `node -r`: in-memory stand-in for the keytar native addon,
// which needs libsecret. Saved secrets are lost when the server restarts.
const Module = require('module');

const store = new Map();
const key = (service, account) => service + '\0' + account;
const keytar = {
    getPassword: async (s, a) => store.get(key(s, a)) ?? null,
    setPassword: async (s, a, p) => { store.set(key(s, a), p); },
    deletePassword: async (s, a) => store.delete(key(s, a)),
    findPassword: async s => {
        for (const [k, p] of store) { if (k.startsWith(s + '\0')) { return p; } }
        return null;
    },
    findCredentials: async s => [...store]
        .filter(([k]) => k.startsWith(s + '\0'))
        .map(([k, password]) => ({ account: k.slice(s.length + 1), password }))
};

const load = Module._load;
Module._load = function (request, ...rest) {
    return request.split('/').pop() === 'keytar.node' ? keytar : load.call(this, request, ...rest);
};
