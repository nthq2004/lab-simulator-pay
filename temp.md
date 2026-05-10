
# 1. 设置 API 地址为 DeepSeek 提供的 Anthropic 兼容端点
export ANTHROPIC_BASE_URL="https://api.deepseek.com/anthropic"

# 2. 替换为你在 DeepSeek 平台申请的 API Key
export ANTHROPIC_AUTH_TOKEN="sk-e03b6c26f5dc42bf94b7f762164e8a65"

# 3. （可选但推荐）设置超时时间，防止复杂任务断开
export API_TIMEOUT_MS="600000"

# 将 Claude Code 的“主力模型”指向 V4-Pro
export ANTHROPIC_DEFAULT_SONNET_MODEL="deepseek-v4-pro"
export ANTHROPIC_DEFAULT_OPUS_MODEL="deepseek-v4-pro"

# 将“轻量模型”指向 V4-Flash
export ANTHROPIC_DEFAULT_HAIKU_MODEL="deepseek-v4-flash"

# 设置 Claude Code 内部 Agent 使用的模型
export CLAUDE_CODE_SUBAGENT_MODEL="deepseek-v4-pro"

# 清掉之前设错的变量
unset ANTHROPIC_AUTH_TOKEN

# 用正确的变量名设置 API Key
export ANTHROPIC_API_KEY="sk-e03b6c26f5dc42bf94b7f762164e8a65"

# Base URL 保持不变
export ANTHROPIC_BASE_URL="https://api.deepseek.com/anthropic"

# 关闭 SSL 校验（防止本地代理拦截）
export NODE_TLS_REJECT_UNAUTHORIZED=0

# 然后启动
claude