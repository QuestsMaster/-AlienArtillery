# iPhone acceptance checklist

## Execution record

- Device model: not executed — this implementation environment has no physical iPhone access.
- iOS version: not executed.
- Safari installation result: not executed.
- Airplane Mode offline result: not executed.
- Deferred visual tuning: iPhone safe-area/control ergonomics still require physical-device review at 844x390 and 852x393 landscape.

No device result is claimed in this record. Execute and replace the entries above with the real model, iOS version, date, and observed results before release.

## Required acceptance procedure

1. Serve `dist/` over HTTPS.
2. Open in iPhone Safari and wait for `Готово к офлайн-игре`.
3. Add to Home Screen, cold-launch in portrait, verify the rotate overlay, then rotate to landscape and verify the live match appears without a reload.
4. At both 844x390 and 852x393 landscape sizes, verify the canvas, six-member roster, warning/recovery panel, weapon controls, aim/fire controls, and offline status remain inside the safe area.
5. Hold each walk button for at least two seconds and verify continuous movement stops on release; verify only one controlled jump is accepted in the turn.
6. Drag around the circular aim controller and verify the trajectory changes continuously. Hold fire briefly and then for the full charge interval; verify release launches visibly different power levels and cancellation/rotation does not launch.
7. Fire both bazooka and grenade. Verify the camera starts on the active alien, follows each projectile, centers the explosion, and returns to the next active fighter while manual pan/zoom remains usable.
8. Verify visible shot, explosion, damage, and defeat feedback; verify roster health, active marker, defeated fighter art, the first defeat, the last defeat, a winner screen, and a simultaneous-final-KO draw screen.
9. Close the app during the next stable turn, reopen it, and verify match recovery with the current viewport rather than the saved device dimensions.
10. Test a corrupt save and an unavailable/failing IndexedDB session. Verify the recovery/new-match actions and visible warning remain on-screen and the fallback match stays playable.
11. After one complete online load, remove the app from the app switcher, enable Airplane Mode, cold-launch from the Home Screen, reload once while still offline, and complete a match.
12. Disable Airplane Mode, publish a new build, and verify a waiting worker remains deferred throughout an active saved match. Complete the match, then verify activation/reload uses the new build and the completed save remains coherent.

## Expected update behavior

The page reports that an update will be applied after the match when a new worker is waiting during an active match. It only requests worker activation once there is no active match or the match is complete; the worker does not skip waiting during installation.
