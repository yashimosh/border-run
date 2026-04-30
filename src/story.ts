// Story — narrative system for Border Run.
//
// One incident per run. Canonical incident: West Mosul, June 2017 — Sor drives
// a journalist + videographer across mountain back-roads to interview a Yezidi
// survivor. The route geometry is the existing world; the narrative reframes it.
//
// All text is in second person, present tense. Sor (the player) is silent.
// The character speaks through what he wears, what he plays on the radio, what
// is in his cabin, and how he drives — never through dialogue.
//
// Beats fire when the truck's world-z crosses thresholds tied to existing
// landmarks (cairn at z=-50, wreck at z=-30, watchtower at z=+64, etc.).
// The ending is selected by cargo state at the moment the truck passes the
// border line and continues into the destination zone.
//
// Designed to extend: more incidents (2014 Sinjar, 2015 Kobani, 2016 Mosul…)
// can be added as additional IncidentText structs and chosen at run start.

export interface StoryBeat {
  /** Truck world-z at which the beat fires. Beat fires when truck z crosses this value. */
  triggerZ: number;
  /** Brief text shown via the existing #event flash element. */
  text: string;
  /** Set true once fired so it doesn't repeat if the truck zigzags. */
  fired: boolean;
}

export interface IncidentText {
  /** Year/month stamp for the HUD or radio cues, e.g. "June 2017". */
  date: string;
  /** Intro card paragraphs. First line is the dateline (smaller, uppercase). */
  intro: string[];
  /** Position-triggered mid-run beats. */
  beats: StoryBeat[];
  /** Ending variants by cargo state. */
  endings: {
    clean:   string[];
    partial: string[];
    failed:  string[];
  };
}

// ── Canonical incident ────────────────────────────────────────────────────────
// West Mosul, June 2017. The hardest phase of the offensive. The interview is
// with a Yezidi woman whose brothers were taken in 2014 — first willing to give
// a full-name on-camera testimony. The team is two: a journalist and a
// videographer Sor doesn't know. Bakhtiyar Haddad was killed in the same
// district three weeks ago. Sor doesn't say.

const CANONICAL: IncidentText = {
  date: "June 2017",

  intro: [
    "JUNE 2017 — OLD CITY",
    "The old city is mostly bricks now.",
    "You drove a French team last week. They were yours all morning. They sent another.",
    "This one is two: a journalist, and the videographer she works with. She's American. He's not.",
    "The interview is with a woman whose brothers were taken in 2014. She has agreed to a name and a face.",
    "Two camera cases. A satellite phone. Body armour they haven't worn yet. A hard drive of last week's footage.",
    "Engine on at 04:47. The streets are still empty.",
  ],

  beats: [
    {
      // Early south corridor — sets the weight before the road gets technical.
      triggerZ: -100,
      text: "Bakhtiyar took an IED in the Old City three weeks ago. The videographer reminds you of him. You don't say.",
      fired: false,
    },
    {
      // First cairn at z=-90 — bookends the Bakhtiyar line.
      triggerZ: -85,
      text: "Awat. He stopped driving in '15. He was tired. Now he's a stone.",
      fired: false,
    },
    {
      // Wreck at z=-30 — the JDAM line.
      triggerZ: -32,
      text: "The Hilux took a JDAM in March. Two were inside. Coalition said they had clearance.",
      fired: false,
    },
    {
      // Cairn at z=-10 — Shifa Gardi reference.
      triggerZ: -12,
      text: "Shifa Gardi. Rudaw. February. The bomb was not for her.",
      fired: false,
    },
    {
      // Approaching the watchtower (z=64) — the surveillance beat.
      triggerZ: 35,
      text: "They've been told there are papers crossing tonight. They don't know which truck.",
      fired: false,
    },
    {
      // Past the border, approaching the destination zone.
      triggerZ: 90,
      text: "Every house here has someone who didn't come back.",
      fired: false,
    },
  ],

  endings: {
    clean: [
      "JUNE 2017 — AFTER",
      "You drop them at the Divan. They fly Friday.",
      "The piece runs in three weeks. Six pages, color photographs, the names of the brothers in the captions. People read the names.",
      "You drive home to Ankawa.",
      "The phone rings at 02:00 on Sunday. Another one is in tonight.",
    ],
    partial: [
      "JUNE 2017 — AFTER",
      "You drop them at the Divan. The journalist tells the desk what footage survived.",
      "The piece runs partial. The names are in the captions but the photographs are someone else's.",
      "Critics will note the gaps. You don't read the criticism.",
      "You drive home to Ankawa. The phone rings on Sunday.",
    ],
    failed: [
      "JUNE 2017 — AFTER",
      "You drop them at the Divan. They don't speak much on the way back.",
      "The story does not file in time. The desk runs something else.",
      "The interview is published a year later in a book that almost no one buys. Her brothers are still named, somewhere. Just not where the world will read them.",
      "You drive home to Ankawa. You don't sleep that night.",
    ],
  },
};

// ── Story controller ──────────────────────────────────────────────────────────

export class Story {
  private incident: IncidentText = CANONICAL;
  private flashFn: (t: string) => void;

  // DOM
  private cardEl:       HTMLDivElement;
  private cardTextEl:   HTMLDivElement;
  private cardActionEl: HTMLButtonElement;

  // State
  private introShown = false;
  private endingShown = false;

  // Border-crossing → ending sequencing
  private borderCrossedAt: number | null = null;
  private endingDelaySec = 6.0;

  constructor(flashFn: (t: string) => void) {
    this.flashFn = flashFn;
    this.cardEl       = document.getElementById("story-card")        as HTMLDivElement;
    this.cardTextEl   = document.getElementById("story-card-text")   as HTMLDivElement;
    this.cardActionEl = document.getElementById("story-card-action") as HTMLButtonElement;

    if (!this.cardEl || !this.cardTextEl || !this.cardActionEl) {
      console.warn("[story] DOM elements missing — story card will not render.");
    }
  }

  /**
   * Show the intro card. Resolves when the player dismisses it.
   * Block driving input on the caller side until this resolves.
   */
  showIntro(): Promise<void> {
    if (this.introShown) return Promise.resolve();
    this.introShown = true;

    return new Promise((resolve) => {
      if (!this.cardEl) { resolve(); return; }

      this.renderCard(this.incident.intro, "drive");
      this.cardEl.classList.add("show");

      const onClick = () => {
        this.cardActionEl.removeEventListener("click", onClick);
        this.cardEl.classList.remove("show");
        resolve();
      };
      this.cardActionEl.addEventListener("click", onClick);
    });
  }

  /**
   * Called every tick. Fires position-triggered beats and manages the
   * ending sequence once the border has been crossed.
   *
   * @param truckZ          truck world-z position
   * @param crossedBorder   true the moment the truck first passes BORDER_Z
   * @param now             elapsed clock seconds (for ending delay)
   * @param cargoSecured    cargo items still on/with the truck
   * @param cargoTotal      original cargo count
   */
  update(
    truckZ: number,
    crossedBorder: boolean,
    now: number,
    cargoSecured: number,
    cargoTotal: number,
  ) {
    if (this.endingShown) return;

    // Mid-run beats
    for (const beat of this.incident.beats) {
      if (!beat.fired && truckZ >= beat.triggerZ) {
        beat.fired = true;
        this.flashFn(beat.text);
      }
    }

    // Ending sequencing — start a delay timer the moment we first cross
    // the border, then fire the ending after the player has had a moment
    // in the destination zone.
    if (crossedBorder && this.borderCrossedAt === null) {
      this.borderCrossedAt = now;
    }
    if (
      this.borderCrossedAt !== null &&
      now - this.borderCrossedAt >= this.endingDelaySec
    ) {
      this.fireEnding(cargoSecured, cargoTotal);
    }
  }

  /** Has the ending card been shown? Used by the main loop to halt input. */
  isEnded(): boolean { return this.endingShown; }

  /** Force the ending immediately (used for failure conditions other than border crossing). */
  forceEnding(cargoSecured: number, cargoTotal: number) {
    if (this.endingShown) return;
    this.fireEnding(cargoSecured, cargoTotal);
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private fireEnding(cargoSecured: number, cargoTotal: number) {
    this.endingShown = true;

    let lines: string[];
    if (cargoSecured >= cargoTotal)      lines = this.incident.endings.clean;
    else if (cargoSecured > 0)           lines = this.incident.endings.partial;
    else                                 lines = this.incident.endings.failed;

    this.renderCard(lines, "again");
    if (this.cardEl) this.cardEl.classList.add("show");

    const onClick = () => {
      this.cardActionEl.removeEventListener("click", onClick);
      // Restart by reloading. Keeps state simple — no run-state carry-over.
      location.reload();
    };
    this.cardActionEl.addEventListener("click", onClick);
  }

  private renderCard(lines: string[], actionLabel: string) {
    if (!this.cardTextEl || !this.cardActionEl) return;
    // First line is treated as a dateline (small caps, dimmer).
    const [dateline, ...body] = lines;
    const html =
      `<p class="dateline">${dateline}</p>` +
      body.map(l => `<p>${l}</p>`).join("");
    this.cardTextEl.innerHTML = html;
    this.cardActionEl.textContent = actionLabel;
  }
}
