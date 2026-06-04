## 2024-06-04 - React.memo Canvas Optimization
**Learning:** The `MapInterpolated` component renders an intensive 2D canvas with 60 FPS requestAnimationFrame loops. Unnecessary re-renders triggered by parent state changes cause the entire canvas context and loops to be recreated, introducing severe jank.
**Action:** Always wrap heavy canvas components with `React.memo` to ensure they only re-render when actual props (like driver locations or target destinations) change.
