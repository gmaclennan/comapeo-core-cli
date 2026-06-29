# VHS tape — records the self-playing demo to a GIF/MP4 for the team.
# Install VHS once:  brew install vhs   (https://github.com/charmbracelet/vhs)
# Then:              vhs demo/demo.tape
# Produces:          demo/demo.mp4 (plus demo.gif)
#
# Recorded at @2x (FontSize 32) and cropped close to the TUI.

Output demo/demo.mp4
Output demo/demo.gif

Set Shell "bash"
Set FontSize 32
Set Width 1900
Set Height 780
Set Padding 20
Set Theme "IR_Black"

# The demo plays itself (~62s); just launch it and let it run.
Type "npm run demo"
Enter
Sleep 68s
