"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Reveal } from "./motion/reveal";
import { FAQ_ITEMS } from "./landing-content";

export function FaqSection() {
  const [openIndex, setOpenIndex] = useState(0);
  const panelRefs = useRef<Array<HTMLDivElement | null>>([]);

  function setPanel(index: number, open: boolean) {
    const panel = panelRefs.current[index];
    if (!panel) return;
    panel.style.height = open ? panel.scrollHeight + "px" : "0px";
  }

  useLayoutEffect(() => {
    FAQ_ITEMS.forEach((_, i) => setPanel(i, i === openIndex));
  }, [openIndex]);

  useEffect(() => {
    function onResize() {
      if (openIndex >= 0) setPanel(openIndex, true);
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [openIndex]);

  return (
    <section className="section faq" id="faq">
      <div className="container faq__grid">
        <Reveal className="faq__intro">
          <h2 className="h2">
            Frequently asked <span className="accent">questions</span>
          </h2>
          <p className="p">
            Everything about cohorts, consent and how companies see your work.
            Still stuck? The contact form below reaches a human.
          </p>
        </Reveal>

        <Reveal className="faq__list" id="faqList">
          {FAQ_ITEMS.map((item, i) => {
            const open = i === openIndex;
            return (
              <div
                className={open ? "faq__item is-open" : "faq__item"}
                key={item.q}
              >
                <button
                  className="faq__q"
                  type="button"
                  aria-expanded={open}
                  onClick={() => setOpenIndex(open ? -1 : i)}
                >
                  <span>{item.q}</span>
                  <span className="faq__icon" aria-hidden="true"></span>
                </button>
                <div
                  className="faq__a"
                  ref={(node) => {
                    panelRefs.current[i] = node;
                  }}
                >
                  <p>{item.a}</p>
                </div>
              </div>
            );
          })}
        </Reveal>
      </div>
    </section>
  );
}
