-- AddConstraint
ALTER TABLE "establishments"
  ADD CONSTRAINT "establishments_timezone_check"
  CHECK (timezone IN (
    'Europe/Kyiv',
    'Europe/Warsaw',
    'Europe/Prague',
    'Europe/Berlin',
    'Europe/Riga'
  ));
