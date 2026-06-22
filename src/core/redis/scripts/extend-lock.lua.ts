// KEYS[1]=lock:<key>; ARGV[1]=token, ARGV[2]=ttlMs. Chỉ PEXPIRE khi token khớp (tránh
// gia hạn nhầm lock người khác đã chiếm). Trả 1 (gia hạn được) hoặc 0 (đã mất lock).
export const extendLock = {
  numberOfKeys: 1,
  lua: `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("pexpire", KEYS[1], tonumber(ARGV[2]))
else
  return 0
end`,
};
