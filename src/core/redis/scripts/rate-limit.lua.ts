// KEYS[1]=rl:<key>; ARGV[1]=now(ms), ARGV[2]=window(ms), ARGV[3]=limit, ARGV[4]=member(unique).
// Sliding-window log atomic. Trả { allowed(0/1), remaining, oldest(ms) }.
// oldest = score entry sớm nhất còn trong cửa sổ (sau cleanup); rỗng → now. Caller tính
// resetAt = oldest + window (thời điểm slot sớm nhất rời cửa sổ — đúng cho request bị từ chối).
export const rateLimit = {
  numberOfKeys: 1,
  lua: `
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
redis.call("zremrangebyscore", KEYS[1], 0, now - window)
local count = redis.call("zcard", KEYS[1])
local allowed = 0
if count < limit then
  redis.call("zadd", KEYS[1], now, ARGV[4])
  redis.call("pexpire", KEYS[1], window)
  count = count + 1
  allowed = 1
end
local remaining = limit - count
if remaining < 0 then remaining = 0 end
local oldest = now
local first = redis.call("zrange", KEYS[1], 0, 0, "WITHSCORES")
if first[2] then oldest = tonumber(first[2]) end
return { allowed, remaining, oldest }`,
};
