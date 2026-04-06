#!/bin/bash

# =============================================================================
# GitHub 自动同步脚本
# 用法: ./sync-to-github.sh [提交信息]
# =============================================================================

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 获取当前时间作为默认提交信息
TIMESTAMP=$(date "+%Y-%m-%d %H:%M:%S")
DEFAULT_MESSAGE="update: $TIMESTAMP"

# 使用传入的参数或默认信息
COMMIT_MESSAGE="${1:-$DEFAULT_MESSAGE}"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  🚀 开始同步到 GitHub${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# 检查是否在 git 仓库中
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    echo -e "${RED}❌ 错误: 当前目录不是 Git 仓库${NC}"
    exit 1
fi

# 获取当前分支
CURRENT_BRANCH=$(git branch --show-current)
echo -e "${YELLOW}📌 当前分支: $CURRENT_BRANCH${NC}"
echo -e "${YELLOW}📝 提交信息: $COMMIT_MESSAGE${NC}"
echo ""

# 显示当前状态
echo -e "${BLUE}📊 当前 Git 状态:${NC}"
git status --short
echo ""

# 检查是否有变更需要提交
if git diff --quiet && git diff --staged --quiet && [ -z "$(git ls-files --others --exclude-standard)" ]; then
    echo -e "${GREEN}✅ 没有需要提交的变更，正在检查远程更新...${NC}"
else
    # 添加所有变更（包括新增、修改、删除）
    echo -e "${BLUE}➕ 添加所有变更到暂存区...${NC}"
    git add -A
    
    # 提交变更
    echo -e "${BLUE}💾 提交变更...${NC}"
    if ! git commit -m "$COMMIT_MESSAGE"; then
        echo -e "${RED}❌ 提交失败${NC}"
        exit 1
    fi
    echo -e "${GREEN}✅ 提交成功${NC}"
    echo ""
fi

# 拉取远程更新（避免冲突）
echo -e "${BLUE}⬇️  拉取远程更新...${NC}"
if ! git pull origin "$CURRENT_BRANCH" --rebase; then
    echo -e "${RED}❌ 拉取远程更新失败，可能存在冲突${NC}"
    echo -e "${YELLOW}💡 提示: 请手动解决冲突后再运行此脚本${NC}"
    exit 1
fi
echo -e "${GREEN}✅ 已同步远程更新${NC}"
echo ""

# 推送到 GitHub
echo -e "${BLUE}⬆️  推送到 GitHub...${NC}"
if ! git push origin "$CURRENT_BRANCH"; then
    echo -e "${RED}❌ 推送失败${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  ✅ 同步成功!${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "${YELLOW}📎 仓库地址: $(git remote get-url origin)${NC}"
echo -e "${YELLOW}🌿 分支: $CURRENT_BRANCH${NC}"
