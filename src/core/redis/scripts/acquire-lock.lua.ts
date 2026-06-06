// KEYS[1]=lock:<key>, KEYS[2]=lock:fence:<key>; ARGV[1]=token, ARGV[2]=ttlMs.
// Atomic: SET NX PX rồi INCR fencing — trả fencingToken (số) khi giữ được, false (→ null) khi đã bị giữ.
export const acquireLock = {
  numberOfKeys: 2,
  lua: `
if redis.call("set", KEYS[1], ARGV[1], "NX", "PX", tonumber(ARGV[2])) then
  return redis.call("incr", KEYS[2])
else
  return false
end`,
};
