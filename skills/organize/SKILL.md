---
name: content-organize
description: Revise the selected passage or whole draft in the AI content workbench while preserving meaning and evidence. Use when the user triggers 整理, asks to structure writing, or prepares a draft for human review.
---

# 整理选区或全文

对当前选区或全文进行结构、逻辑、语言整理，保留原意和具体信息。不要把未经核实的表述写成确定事实，不擅自扩大结论。

`revisedBody` 返回整理后的完整选区或全文；`reviewNotes` 说明主要改动；`needsConfirmation` 只列现有待核实清单未覆盖的新问题，最多三条。作品仍需人工审稿。文体规则由调用方提供。
