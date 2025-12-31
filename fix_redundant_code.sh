#!/bin/bash

# 修复 apiUtils.ts 中的冗余代码
sed -i '6a\n/**\n * 移除 URL 末尾的斜杠\n */\nfunction removeTrailingSlash(url: string): string {\n  return url.endsWith('"'"'/'"'"') ? url.slice(0, -1) : url;\n}' src/utils/apiUtils.ts

# 替换第16行
sed -i '16s/.*/    if (customUrl) return removeTrailingSlash(customUrl);/' src/utils/apiUtils.ts

# 替换第22行
sed -i '22s/.*/    return removeTrailingSlash(envUrl);/' src/utils/apiUtils.ts

# 替换第102行
sed -i '102s/.*/    this.baseUrl = removeTrailingSlash(url);/' src/utils/apiUtils.ts

echo "修复完成！"
