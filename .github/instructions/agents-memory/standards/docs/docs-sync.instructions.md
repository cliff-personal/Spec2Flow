# Docs Sync Baseline

适用范围：README、docs、llms、模板说明、命令说明。

## 规则

1. 行为变更必须同步更新对应 docs、code、tests 或 validation
2. CLI 命令变更必须同步更新 README、docs/getting-started、llms.txt
3. 产品定位变更必须同步更新产品文档和 docs 入口
4. 新模板、新目录、新校验命令必须写入 docs map

## 删除规则

1. 废弃功能必须删除对应文档，而不是只标注 TODO
2. 文档说明的能力若无实现，应改为 planned 或 roadmap