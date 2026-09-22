-- migrate:up

-- **Die Markierung einer Test-Rundmail steht nicht mehr im Text.**
--
-- Bisher begann jede Test-Rundmail mit „— TEST-Rundmail —" und einer Leerzeile, gespeichert im
-- Text der Nachricht. Gewünscht ist sie fett und gesperrt, und das kann ein gespeichertes
-- Textstück nicht. Die Oberfläche zeichnet sie jetzt selbst, am Test-Faden. Was schon verschickt
-- ist, trüge sie sonst doppelt: einmal gezeichnet, einmal im Text.
--
-- **Nur in Test-Fäden, und nur genau dieser Anfang.** Verglichen wird mit `left(…) =`, nicht mit
-- `LIKE`: Die Markierung enthält nichts, was `LIKE` besonders behandelt, aber ein Vergleich, der
-- darauf nicht angewiesen ist, bleibt richtig, wenn sich das einmal ändert.
--
-- Verschiebt Daten, also vorher eine frische Sicherung. Umkehrbar ist es trotzdem: Der Rückweg
-- setzt die Markierung wieder vor jede Nachricht in einem Test-Faden, wie der alte Code sie schrieb.
UPDATE public.chat_message AS m
SET text = substr(m.text, char_length(E'— TEST-Rundmail —\n\n') + 1)
FROM public.chat_group AS g
WHERE g.id = m.chat_group_id
  AND g.is_test_broadcast
  AND left(m.text, char_length(E'— TEST-Rundmail —\n\n')) = E'— TEST-Rundmail —\n\n';

-- migrate:down

UPDATE public.chat_message AS m
SET text = E'— TEST-Rundmail —\n\n' || m.text
FROM public.chat_group AS g
WHERE g.id = m.chat_group_id
  AND g.is_test_broadcast
  AND left(m.text, char_length(E'— TEST-Rundmail —\n\n')) <> E'— TEST-Rundmail —\n\n';
