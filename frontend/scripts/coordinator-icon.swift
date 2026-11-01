import AppKit

// One coordinator linked to two independent workers; no external image assets.
let destination = CommandLine.arguments[1]
// Render actual pixels instead of lockFocus's display-dependent Retina size.
// The visible tile is inset 100 px on a 1024 px transparent icon canvas, so
// Dock renders it at the same optical size as standard macOS application tiles.
let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 1024, pixelsHigh: 1024,
 bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
 colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
bitmap.size = NSSize(width: 1024, height: 1024)
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
NSColor.clear.setFill()
NSRect(x: 0, y: 0, width: 1024, height: 1024).fill(using: .copy)
let inset = NSAffineTransform()
inset.translateX(by: 100, yBy: 100)
inset.scale(by: 824.0 / 1024.0)
inset.concat()
let background = NSBezierPath(roundedRect: NSRect(x: 0, y: 0, width: 1024, height: 1024), xRadius: 224, yRadius: 224)
NSGradient(starting: NSColor(calibratedRed: 0.12, green: 0.18, blue: 0.29, alpha: 1), ending: NSColor(calibratedRed: 0.07, green: 0.11, blue: 0.20, alpha: 1))!.draw(in: background, angle: 90)
NSColor(calibratedRed: 0.43, green: 0.58, blue: 0.94, alpha: 1).setStroke()
let connector = NSBezierPath()
connector.lineWidth = 30
connector.lineCapStyle = .round
connector.lineJoinStyle = .round
connector.move(to: NSPoint(x: 512, y: 670)); connector.line(to: NSPoint(x: 512, y: 525))
connector.move(to: NSPoint(x: 280, y: 360)); connector.line(to: NSPoint(x: 280, y: 525)); connector.line(to: NSPoint(x: 744, y: 525)); connector.line(to: NSPoint(x: 744, y: 360))
connector.stroke()
for (x, y, radius) in [(512.0, 718.0, 112.0), (280.0, 325.0, 90.0), (744.0, 325.0, 90.0)] {
 NSColor(calibratedRed: 0.36, green: 0.51, blue: 0.91, alpha: 1).setFill()
 NSBezierPath(ovalIn: NSRect(x: x-radius, y: y-radius, width: radius*2, height: radius*2)).fill()
 NSColor(calibratedRed: 0.88, green: 0.93, blue: 1, alpha: 1).setFill()
 NSBezierPath(ovalIn: NSRect(x: x-radius*0.38, y: y-radius*0.38, width: radius*0.76, height: radius*0.76)).fill()
}
NSGraphicsContext.restoreGraphicsState()
try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: destination))
