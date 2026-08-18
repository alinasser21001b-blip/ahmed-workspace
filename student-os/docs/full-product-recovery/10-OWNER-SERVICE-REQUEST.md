# 10 — WHAT THE OWNER NEEDS TO PROVIDE

Plain language, one page. Each item is something the code is already written
for and cannot do without an account that only you can open. Nothing here was
signed up for on your behalf, and no credentials were invented.

Everything else in Student OS works without you doing anything.

---

## SERVICE 1 — Email sending (needed to launch)

**WHY:** So a student who forgets their password can get a reset link.

**BLOCKS:** Password reset — nothing else.

**HOW BAD IS IT NOW:** A student who forgets their password is locked out
permanently. The reset screen works, the link is created correctly, and then
nothing sends it. This is the one gap that will hurt real students on day one.

**OWNER MUST DO:** Open a free account with one email service and give me the
key. Any of these are free at the volume a college app needs:
- Resend — 3,000 emails a month free
- Brevo — 300 emails a day free

**CLAUDE WILL DO AFTERWARD:** Add the key to the site settings and write the
sending code. It is one function; everything around it is already built and
tested.

---

## SERVICE 2 — A server that can hold a live connection (optional for now)

**WHY:** So chat messages arrive instantly, and typing and presence work.

**BLOCKS:** Live message delivery, typing indicators, read receipts arriving on
their own.

**HOW BAD IS IT NOW:** Chat works. Messages send and load normally, and the app
says plainly that live delivery is unavailable. You refresh or reopen to see new
messages. Nothing is broken; it is slower than it should be.

**WHY IT CANNOT WORK TODAY:** Netlify runs the API as a function that starts and
stops for each request. A live connection has to stay open, so it can never work
there. The code for it is finished and works on a normal server — it is the host
that cannot.

**OWNER MUST DO:** Only if you want live chat now — open a free account on a
host that runs a normal always-on server (Fly.io or Render both have free
tiers). Note their free tiers put the server to sleep when idle.

**CLAUDE WILL DO AFTERWARD:** Deploy the existing API there, point the app at
it, and add the small piece that lets more than one server share live
connections.

---

## SERVICE 3 — Error and uptime monitoring (recommended, not blocking)

**WHY:** So you find out when the site breaks, instead of a student telling you.

**BLOCKS:** Nothing a student sees.

**HOW BAD IS IT NOW:** If the site goes down at 2am, nobody is told. The app
writes good logs, but nothing watches them.

**OWNER MUST DO:** Open free accounts:
- UptimeRobot — free, watches the site and emails you when it stops answering
- Sentry — free tier, tells you when the app crashes and where

**CLAUDE WILL DO AFTERWARD:** Point them at the health endpoints that already
exist, and add the crash reporting.

---

## SERVICE 4 — Push notifications (only when you want them)

**WHY:** So a student is told about a reply or a new message when the app is
closed.

**BLOCKS:** All notifications outside the app.

**HOW BAD IS IT NOW:** There are none, and the app says so honestly rather than
showing a switch that does nothing.

**IMPORTANT:** This one is mostly missing *code*, not a missing account —
the database tables exist, but nothing sends anything. Expo's push service is
free. This is a piece of work to schedule, not a purchase.

**OWNER MUST DO:** Tell me when you want it built.

---

## Two things you may expect to be here, and are not

**Database and file storage.** Both are already handled by Netlify — the
database and the image storage come with the site. You do not need to buy or
connect anything for posts, images or lecture materials to work. What the site
does need is a few settings switched on in the Netlify dashboard, which I will
do as part of deploying.

**A domain name.** Not needed. The app runs on its free `netlify.app` address
with a valid certificate. A custom domain is yours to buy if and when you want
one — nothing waits on it.

---

## One thing that is not a service at all

**Practice questions.** The practice feature is complete and tested, but in a
fresh database there are no questions in it, because nothing in the product
creates them — they only exist in a developer seeding script. No account or
purchase fixes this. It is a decision only you can make:

- who writes the questions (you, instructors, senior students), and
- whether I should build the screen they write them in.

I have not invented medical questions to fill the gap, and I would advise
strongly against anyone doing so.
