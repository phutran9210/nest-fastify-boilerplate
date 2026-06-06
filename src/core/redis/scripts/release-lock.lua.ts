// KEYS[1]=lock:<key>; ARGV[1]=token. Chỉ del khi token khớp (compare-then-del). Trả 1 hoặc 0.
// (Redis 8.4+ có `DELEX key IFEQ token` native; cố ý giữ Lua để chạy trên Redis 6/7/8 — xem spec §5.2/§7.)
export const releaseLock = {
  numberOfKeys: 1,
  lua: `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end`,
};
