# <p align="center">🪷 SHAPLA CHOTTOR 🪷</p>
## <p align="center">Brand Visual Identity & Design System `v1.5`</p>

<p align="center">
  <img src="https://img.shields.io/badge/Status-Active-2E7D32?style=for-the-badge&logo=android" />
  <img src="https://img.shields.io/badge/Version-1.5-D4AF37?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Design-Premium-0F4C5C?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Experience-High--Trust-121212?style=for-the-badge" />
</p>

---

### 🏛️ Brand Philosophy
> **"From the mud of complexity, clarity blooms."**
> 
> The Shapla Chottor identity is a commitment to user trust, eye health, and professional stability. We move away from "flashy" tech aesthetics toward a calm, research-oriented atmosphere where intelligence feels natural, grounded, and high-value.

---

### 🎨 The Signature Palette
*Functional signals designed for long-term professional focus and eye relief.*

| | Tone | Token | HEX | Emotional Anchor |
| :--- | :--- | :--- | :--- | :--- |
| 🟢 | **Shapla Green** | `@color/shapla_green` | `#2E7D32` | **Growth** — Progress & Vitality |
| ⚪ | **Water White** | `@color/water_white` | `#E0E2E0` | **Clarity** — Anti-glare Focus |
| 🟡 | **Soft Gold** | `@color/soft_gold` | `#D4AF37` | **Value** — Premium Insights |
| 🌊 | **Deep Teal** | `@color/deep_teal` | `#0F4C5C` | **Wisdom** — Research Authority |
| ⬛ | **Night Onyx** | `@color/night_onyx` | `#121212` | **Stability** — Maximum Legibility |

---

### 💎 The "Bloom" Design Standards
*We define "Beauty" as the intersection of Elegance and Usability.*

#### 1️⃣ Visual Rhythm (Spacing & Radii)
*   **Organic Curves:** 
    *   Standard containers: `24dp` corners.
    *   High-impact elements (Buttons/Featured Cards): `28dp` corners.
*   **Breathing Room:** Always maintain a `16dp` inner padding (Gutter) and `24dp` outer margins for headers.
*   **Surface Separation:** Surfaces are separated by depth (`Elevation`), never by heavy lines.

#### 2️⃣ Elevation & Depth (The 3D System)
*   **Layer 0 (Base):** `Water White (#E0E2E0)` — The "Water" surface.
*   **Layer 1 (Cards):** `White (#FFFFFF)` with `2dp` Elevation. Soft `20% Alpha` shadows.
*   **Layer 2 (Interactions):** Shapla Green or Deep Teal accents that "glow" upon interaction.

---

### 🛡️ Iconography: Functional Art
*Icons follow a strict **3D Layering** rule to evoke quality and depth.*

*   **Colorful Glyphs:** Navigation uses the `ic_*_colorful.xml` set.
*   **Semantic Color Mapping:** 
    *   📘 **Courses:** Deep Teal (Theory & Wisdom)
    *   📗 **Practical:** Shapla Green (Implementation & Growth)
    *   📙 **Learning:** Soft Gold (Progress & Achievement)

---

### 📜 The Golden Rules of "Shapla Design"
> [!IMPORTANT]
> **EYE RELIEF IS NON-NEGOTIABLE:** Never use pure `#FFFFFF` for screen-wide backgrounds. Protect the researcher's vision.

1.  **Instructional Clarity:** Use direct verbs like "Wait for" or "Install."
2.  **Minimalist Intent:** If an element doesn't help the user take the *next step*, it must be removed.
3.  **Visual Trust:** Every transition and state change (like a countdown timer) must use the brand's **Soft Gold**.

---

### 🛠️ Developer Implementation
*Standard for all "Practical Implementation" items.*

```xml
<com.google.android.material.card.MaterialCardView
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    app:cardCornerRadius="24dp"
    app:cardElevation="2dp"
    app:strokeWidth="0dp">

    <LinearLayout
        android:padding="20dp"
        android:gravity="center_vertical"
        android:orientation="horizontal">
        <!-- 🪷 Icon (40dp) | 📝 Text Stack (Weight 1) | ▶️ Action Icon -->
    </LinearLayout>
</com.google.android.material.card.MaterialCardView>
```

---

### 📈 Governance
*   **Lab:** Shapla Chottor AI Research
*   **Custodian:** Sushen Biswas
*   **Latest Change:** `v1.5` - Enhanced visual hierarchy and semantic color mapping.

---
<p align="center">
  <i>Complexity simplified. Growth secured.</i><br>
  <b>Shapla Chottor © 2026</b>
</p>
