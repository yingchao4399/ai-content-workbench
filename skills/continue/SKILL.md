---
name: content-continue
description: Continue a note, WeChat article, novel, poem, or essay at the current cursor using the user's material and current text. Use when the user triggers AI 续写 or asks to write the next passage.
---

# 在光标位置续写

生成三个明显不同但都能自然衔接的候选版本，放入 `continuations` 数组；每个版本分别满足用户设置的目标字数、段落数和每段字数，不重复前文，不改写已有正文。选中一段时接在选区末尾；使用 `/` 时在光标处接着写。承接标题、选题卡、素材和指定的前文语境。写具体段落，避免空洞套话。

真实事件仅使用已给材料；素材不够时以清楚的占位说明或 `unknowns` 记录，不编造证据。`unknowns` 只列现有待核实清单未覆盖的新问题，最多三条。`reviewNotes` 简述续写策略和需要人工审看之处。文体规则由调用方提供。
