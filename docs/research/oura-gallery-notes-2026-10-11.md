# Oura app UI reference notes (2026-10-11)

Read-only research. Sources were fetched with `curl` and web search on 2026-10-11 (Melbourne). Each entry is labelled with its evidence level. "Observed" means I looked at the image myself. "Stated" means the source says it in text. Nothing below is inferred from memory.

## Summary of sources

| Source | URL | Type | Gated? | Date visible | Usefulness |
| --- | --- | --- | --- | --- | --- |
| App Store (AU) listing | https://apps.apple.com/au/app/oura/id1043837948 | Official marketing screenshots of the production UI, inside device frames with headline copy | No | Version 7.26.0, "5 days ago" (about 6 Oct 2026); 7.25.0 22 Sept | Best direct visual evidence |
| Oura blog, 2025 redesign | https://ouraring.com/blog/new-app-design/ | Official text | No | 5 November 2025 | Current design intent |
| Oura blog, 2024 redesign | https://ouraring.com/blog/new-oura-app-experience/ | Official text | No | 3 October 2024 | Most detailed tab structure description |
| Mobbin, Oura iOS | e.g. https://mobbin.com/explore/screens/c986d305-8d2a-4194-8928-b943f2347785 | Production screenshots | Images and full flows need a login or Pro plan; only titles and captions are readable | No capture date visible | Index of flows only |
| Page Flows (includes Screenlane) | https://pageflows.com/search/?q=oura | Production gallery | Paid | n/a | No Oura content |
| Screenlane | https://screenlane.com/ | Merged into Page Flows | n/a | n/a | Domain did not respond to `curl` (TLS error) |
| Refero | https://refero.design/apps?search=oura | Production gallery | Client-rendered shell (4 KB HTML, no Oura text) | n/a | Unreadable without a browser |
| UI Sources | https://uisources.com/app/oura | Redirects to https://screensdesign.com/ | n/a | n/a | No Oura text in search results |

Dribbble and Behance concepts were not searched, so these notes contain no concept designs.

## App Store screenshots (observed)

Ten screenshot files, named by Oura, for example `02 - AS - EN - 1284x2778 - Home view - Morning`. I viewed seven: Home view Morning, Vitals Activity, My Health, Sleep details, Heart Health view, Daytime Stress, Today AAD (automatic activity detection). Other file names: Cycle Insights, Advisor. These are marketing images, so data values are staged, but the chrome matches the redesign described by Oura.

Navigation:

- A floating, rounded bottom tab bar with three tabs: **Today** (sun icon), **Vitals** (leaf icon), **My Health** (tree icon). A separate circular **+** button sits to the right of the bar.
- Detail screens swap the tab bar for a floating, icon-only metric switcher: Readiness sprout, Sleep moon, Activity flame, Cycle, Heart, Stress waves, and one more wave icon. A small bar under the active icon marks the selection. This matches the blog's note that you can swipe between metric details.

Today screen (Home view Morning, Today AAD):

- Top bar: hamburger menu, ŌURA wordmark, share icon, ring/device icon.
- A horizontal row of circular score chips: Readiness 88, Sleep 84, Activity 91, Cycle day 6, and a cut-off "He..." chip (likely heart rate, cut off in the image). Small crown icons appear above some scores.
- Hero: a full-bleed photo background (mountain for Readiness, green hills for Steps) with a thin arc gauge from 0 to 100 (0 to 10,000 for steps), a big number, a small caps label (READINESS, STEPS), a large serif headline ("Go get 'em!", "Making progress"), a short sans-serif paragraph and a pill "Learn more" button.
- The AAD variant shows a translucent card above the hero: "Running, 7:10 AM, 34m, 268 Cal, 115 bpm" with Confirm and Edit buttons and a close X.
- Below the hero, cards begin: "Sleep, GOOD" with a chevron.

Vitals:

- Title "Vitals" with a pencil (edit) icon.
- Date navigation: horizontal swipeable labels, "Yesterday" cut off on the left and "Today" with a calendar icon, underlined.
- Section headers with icons (Readiness, Sleep), each with a two-column grid of rounded dark cards: "Readiness Score, Optimal, 88", "Symptom Radar, No signs", "Sleep Score, Good, 84", "Body Clock, Aligned" (with a small two-line arc graphic).
- State words are coloured: Optimal in blue, Good in teal.

Sleep detail:

- Back arrow, "Sleep" title, share icon, then the same Yesterday/Today date strip.
- "Details" with horizontal tabs for each sleep period: "10:30 PM to 6:46 AM, Sleep score 84", "2:25 to 2:50 PM, Sleep score +2", and a third nap.
- Card "TIME ASLEEP 7h 16m, Total duration 8h 16m" with a hypnogram (stepped bars for Awake, REM, Light, Deep in white and shades of blue), start and end time pills, a MOVEMENT tick strip, and a legend with durations and percentages (REM 1h 50m 25%, Light 4h 1m 55%, Deep 1h 25m 20%).

Daytime Stress:

- Purple-tinted background. Line chart with dots from 9am to 12am, with horizontal bands labelled Stressed, Engaged, Relaxed, Restored.
- Toggles under the chart: "Daily movement" and "Tags and activities" (overlays on the chart).
- Summary cards: "STRESSED 45m", "RESTORED 1h 15m", each with a chevron.

My Health:

- Title "My Health" with info and profile icons.
- Hero graphic of curved, layered lines in gradient colours, with floating icon bubbles (stress waves, sleep moon, heart).
- Scale labels "NEEDS CARE" (orange-tinted, left) and "THRIVING" (blue, right).
- Serif headline ("Rising heart health, with a dip in stress management"), body copy, and a pill button "Dive in with Advisor" with a sparkle icon.
- Cards below: "Sleep Health, LOOKING GOOD".

Heart Health detail:

- Status label "THRIVING", serif headline, then a line chart with Above, Aligned, Below bands across Jul, Aug, Sep, and a callout "8 years younger".
- "Key metric" card: "CARDIOVASCULAR AGE, Below, 8 YEARS YOUNGER", "Current week" range picker with chevron, and a segmented Below-to-Above slider.

Visual style seen across screens: near-black dark mode, large rounded cards in dark grey, white sans-serif for UI text, a serif display face for headlines and insights, small caps labels with wide letter spacing, and a tinted glow at the top that changes per metric (teal for sleep, purple for stress, blue for heart). Motion cannot be judged from still images.

## Oura blog: 2025 redesign (stated, 5 Nov 2025)

- Today focuses on "one big thing", the most important score or insight for right now, plus a snapshot of readiness and unusual key metrics.
- Vitals gives a quick view of core pillars (sleep, stress, cardiovascular trends) "anchored" to personal baselines. The new design system "uses color to signal your body's different states".
- My Health has new visualisations of strengths, trends and opportunity areas, plus a new **Habits and Routines** section that links daily behaviours to metrics.
- Oura Advisor (AI) now reads more data, including Meals.

## Oura blog: 2024 redesign (stated, 3 Oct 2024)

- The five old tabs (Home, Readiness, Sleep, Activity, Resilience) became three: Today, Vitals, My Health.
- Today: shortcuts to Sleep, Readiness and Activity scores at the top, plus heart rate, Daytime Stress and Cycle Insights; a daily highlight that changes with time of day; a **Timeline** of the day where you can add tags or activities; and **Discoveries**, which correlate tagged habits with health changes. Oura compares Today to the "Top Stories" page of a news app.
- Vitals: core metrics in one place, personal **baseline ranges**, and contributor detail. "Click the down arrow for top contributors and click the side arrow to view all details", and you can swipe left and right between metric details.
- My Health: slower metrics such as Cardiovascular Age and Stress Resilience shown as long-term graphs, plus weekly, quarterly and yearly reports that can be shared with healthcare providers.

## App Store description (stated)

Mentions three daily scores (Sleep, Activity, Readiness), daily, weekly and monthly trends, and tags such as "caffeine" or "alcohol" to see how choices affect sleep and recovery. Release notes for recent versions are generic ("Small fixes, big improvements").

## Mobbin (titles and captions only, images gated)

Readable without login: screen titles and one-line captions. Flows listed for Oura iOS:

- Onboarding, 25 screens: account setup, ring connection, permissions, personal info, then home (https://mobbin.com/explore/flows/8d024af9-df00-42ca-8b96-40d4571d1294).
- Setting up Cycle Insights, 14 screens: questions about hormonal contraceptives, period start date and cycle length, then data on home (https://mobbin.com/explore/flows/ca6e2d47-2cf1-42e3-b6af-63fdb03634e1).
- Adding a workout, 9 screens (https://mobbin.com/flows/a57f8da1-9ffc-4677-be08-cd66f20682a9).
- My Oura Ring, 4 screens: from health overview to ring management, including readiness and ring settings (https://mobbin.com/explore/flows/84b6faf7-9ca8-444d-85f8-3405ebd545f3).
- Single screens: Home ("data visualization and call to action"), Ring Details (battery and settings), Account Setup, a Tab Bar screen.

Mobbin shows no capture date or app version in the page HTML, so I cannot tell whether these screens predate the 2024 or 2025 redesign.

## Gaps

- No source showed range controls for day, week, month and year on a trend chart. The only range control seen was "Current week" on Heart Health. Secondary coverage (9to5Google, 20 Oct 2025) says Vitals breaks scores down "from days to years", but I did not verify that visually.
- No readable contributor list screenshot. Contributors are described only in the 2024 blog post.
- Android screenshots were not checked (Google Play was not fetched).
- Motion, exact fonts and colour values are not documented in any source I read.
