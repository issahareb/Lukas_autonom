# TaxiBB: request counts versus analytics

The previous dashboard label “Formular gesendet” displayed `funnel.formSubmitSessions`: distinct browser sessions containing a consented form_submit event. It was not a count of requests or delivered emails. Repeated submissions in one session count once, while declined consent, Do-Not-Track and blocked tracking can omit events entirely.

The dashboard now separately displays `funnel.bookings`, which the Taxi API already calculates from saved, non-test booking records by createdAt in the selected rolling period. It includes Hero ride and text requests regardless of analytics consent. The lower contact endpoint sends a notification without a booking record, so it and direct emails are explicitly excluded from this card. A saved request is not proof of email delivery.

Tracking cards now say “Besuche mit …”; the detailed table continues counting individual tracked events. The selector and footer explicitly say “last N days”, not calendar month. No counts are altered or historical events invented. The owner's reported ten emails and five dashboard events have not been independently reconciled against the private live database or mailbox.

Regression coverage uses a synthetic fixture with 10 saved records and 5 tracked successful sessions to ensure they remain distinct, including limitations and period wording. Existing error, empty-period, event-kind and period-selection checks remain in place.
