# NodeSlide OpenUI Phase 0 — live QA summary

- OpenUI is the bounded visual-decision surface; SlideLang remains the editable document layer and Convex remains the proposal/authority layer.
- The AI 2027 fixture renders four incompatible units as a transformation ladder, never a shared quantitative axis.
- The only allowlisted OpenUI action compiles one editable `add_slide` proposal. The deck stays at v1 until explicit Accept, then advances to v2.
- Live proof covered render, propose, compare, accept, accepted-slide visibility, and light/dark themes in a disposable local workspace.
- Two defects discovered during the run were fixed and protected by tests: OpenUI root parsing and `add_slide` candidate selection.
- Gates: 16/16 focused tests, 521/521 repository tests, typecheck, Biome, production build, PPTX overflow, layout bounds, and montage review all passed.
- Mobile responsive pixels are not claimed: the in-app browser retained a 1280×720 viewport after the override request.
