<p align="center">
  <strong>OpenMasjid Students</strong><br/>
  The madrasa office in one app — attendance, grades, report cards, transcripts and tuition.
</p>

<p align="center">
  <em>A self-hosted, madrasa-first school-management app that runs as an <a href="https://github.com/OpenMasjid-Solutions/OpenMasjidOS">OpenMasjidOS</a> app — one Docker container, all data on the masjid's own hardware.</em>
</p>

---

**OpenMasjid Students** is school management built for madāris — weekend maktab,
nazrah and hifz programs, and multi-year ʿālim courses. It is a **four-role app**:
**admins** manage everything (LAN-only), **teachers** take attendance and run their
gradebooks, a **finance manager** runs billing, and **parents** get a phone-first
portal with their kids' grades, schedules, report cards, transcripts and the family
balance — payable by card in-app (Stripe), with autopay.

Payments made through **OpenMasjid Donations** and **OpenMasjid Kiosk** flow in
automatically over the OpenMasjidOS **Fabric**; the app also provides the
`students/billing` capability those apps consume (see
[`docs/FABRIC_BILLING_CONTRACT.md`](docs/FABRIC_BILLING_CONTRACT.md)).

> **Standalone-first.** With no platform, no tunnel, no Donations/Kiosk and no SMTP,
> the app still fully works on the LAN — SIS, timetable, exams, report cards,
> transcripts and manual-payment billing all function; every integration degrades gracefully.

## Status

Early development (`0.1.0`). See [`CHANGELOG.md`](CHANGELOG.md) for what has landed and
`CLAUDE.md` for the full specification and build plan.

## Develop

```bash
npm install          # all workspaces
npm run generate     # generate the initial Drizzle migration (first run)
npm run dev          # server on :8080, web (Vite) on :5173 proxying /trpc /api /fabric /apply
npm run build        # typecheck + build web and server
npm run lint         # tsc --noEmit across workspaces
npm run test         # vitest
```

Open http://localhost:5173 in dev. The design system is ported verbatim from
OpenMasjidOS for visual parity — see [`packages/web/PORTED_FROM_OPENMASJIDOS.md`](packages/web/PORTED_FROM_OPENMASJIDOS.md).

## License

[AGPL-3.0-only](LICENSE). Contributions are governed by the
[CLA](CLA.md) — see [CONTRIBUTING.md](CONTRIBUTING.md).
