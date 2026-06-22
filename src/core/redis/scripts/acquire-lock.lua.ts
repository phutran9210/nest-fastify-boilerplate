// KEYS[1]=lock:<key>, KEYS[2]=lock:fence:<key>; ARGV[1]=token, ARGV[2]=ttlMs, ARGV[3]=fencing('1'|'0').
// Atomic SET NX PX. Nếu fencing='1' → INCR fencing và trả fencingToken; nếu '0' → KHÔNG chạm
// KEYS[2] (tránh leak key) và trả 1 (placeholder). Đã bị giữ → false (→ null).
export const acquireLock = {
  numberOfKeys: 2,
  lua: `
if redis.call("set", KEYS[1], ARGV[1], "NX", "PX", tonumber(ARGV[2])) then
  if ARGV[3] == "1" then
    return redis.call("incr", KEYS[2])
  else
    return 1
  end
else
  return false
end`,
};
