import SwiftUI

/// Custom-styled buttons remain reachable and actionable with keyboard-only navigation.
struct KeyboardActionButton<Label: View>: View {
    @Environment(\.isEnabled) private var isEnabled
    let action: () -> Void
    let label: Label

    init(action: @escaping () -> Void, @ViewBuilder label: () -> Label) {
        self.action = action
        self.label = label()
    }

    var body: some View {
        Button(action: action) { label }
            .focusable()
            .onKeyPress(keys: [.space, .return]) { _ in
                guard isEnabled else { return .ignored }
                action()
                return .handled
            }
    }
}

extension KeyboardActionButton where Label == Text {
    init(_ title: String, action: @escaping () -> Void) {
        self.init(action: action) { Text(title) }
    }
}

/// Small, quiet motion helpers. Every one of them stands still when Reduce Motion is on.

/// Presses in slightly and springs back. Inspired by the squish and sling buttons on reactbits.dev/c/micro.
struct PressStyle: ButtonStyle {
    @Environment(\.lifeOSReduceMotion) private var reduceMotion
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.96 : 1)
            .opacity(configuration.isPressed ? 0.85 : 1)
            .animation(reduceMotion ? nil : .spring(response: 0.25, dampingFraction: 1), value: configuration.isPressed)
    }
}

/// Lifts a card a hair when the pointer is over it.
private struct HoverLift: ViewModifier {
    @Environment(\.lifeOSReduceMotion) private var reduceMotion
    @State private var hovering = false
    func body(content: Content) -> some View {
        content
            .scaleEffect(hovering && !reduceMotion ? 1.008 : 1)
            .shadow(color: .black.opacity(hovering ? 0.22 : 0), radius: 16, y: 8)
            .onHover { hovering = $0 }
            .animation(reduceMotion ? nil : .spring(response: 0.35, dampingFraction: 0.8), value: hovering)
    }
}

/// Soft highlight behind a list row on hover.
private struct HoverTint: ViewModifier {
    let radius: CGFloat
    @Environment(\.lifeOSReduceMotion) private var reduceMotion
    @State private var hovering = false
    func body(content: Content) -> some View {
        content
            .overlay(RoundedRectangle(cornerRadius: radius).fill(Color.white.opacity(hovering ? 0.07 : 0))
                .allowsHitTesting(false))
            .contentShape(RoundedRectangle(cornerRadius: radius))
            .onHover { hovering = $0 }
            .animation(reduceMotion ? nil : .easeOut(duration: 0.15), value: hovering)
    }
}

/// Fades in and rises a few points when first shown.
private struct Rise: ViewModifier {
    let delay: Double
    @Environment(\.lifeOSReduceMotion) private var reduceMotion
    @State private var shown = false
    func body(content: Content) -> some View {
        content
            .opacity(shown || reduceMotion ? 1 : 0)
            .offset(y: shown || reduceMotion ? 0 : 10)
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.easeOut(duration: 0.5).delay(delay)) { shown = true }
            }
    }
}

extension View {
    func hoverLift() -> some View { modifier(HoverLift()) }
    func hoverTint(_ radius: CGFloat = 8) -> some View { modifier(HoverTint(radius: radius)) }
    func rise(_ delay: Double = 0) -> some View { modifier(Rise(delay: delay)) }
}

/// Moves a symbol a few points sideways while the pointer is over its label.
struct NudgeArrow: View {
    let name: String
    @Environment(\.lifeOSReduceMotion) private var reduceMotion
    @State private var hovering = false
    var body: some View {
        Image(systemName: name)
            .offset(x: hovering && !reduceMotion ? 4 : 0)
            .onHover { hovering = $0 }
            .animation(reduceMotion ? nil : .spring(response: 0.3, dampingFraction: 0.5), value: hovering)
    }
}

/// A quiet static mark. Decorative artwork must not wake the app continuously.
struct CometMark: View {
    var body: some View {
            let length = 0.7
            ZStack {
                Circle().stroke(desktopAccent.opacity(0.14), lineWidth: 1.2)
                Circle().trim(from: 0, to: length)
                    .stroke(AngularGradient(colors: [desktopAccent.opacity(0), desktopAccent],
                                            center: .center, startAngle: .degrees(0),
                                            endAngle: .degrees(360 * length)),
                            style: StrokeStyle(lineWidth: 1.6, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                Circle().fill(desktopAccent.opacity(0.55)).frame(width: 3.5, height: 3.5)
            }.frame(width: 17, height: 17).frame(width: 22, height: 22)
            .accessibilityHidden(true)
    }
}


/// Clear, see-through glass with a bright rim, for hero cards that sit over a picture.
/// Falls back to a solid surface when Reduce Transparency or Increase Contrast is on.
struct LiquidSurface: ViewModifier {
    let radius: CGFloat
    /// 0.14 is near clear (hero cards). Around 0.42 is frosted enough to read text on.
    var tint: Double = 0.14
    @Environment(\.lifeOSReduceTransparency) private var reduceTransparency
    @Environment(\.colorSchemeContrast) private var contrast

    @ViewBuilder func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        if reduceTransparency || contrast == .increased {
            content.modifier(SolidReadingSurface(radius: radius))
        } else if #available(macOS 26, *) {
            content
                .glassEffect(Glass.regular.tint(Color.black.opacity(tint)), in: shape)
                .overlay(rim(shape))
        } else {
            content
                .background(.thinMaterial, in: shape)
                .background(Color.black.opacity(tint), in: shape)
                .overlay(rim(shape))
        }
    }

    private func rim(_ shape: RoundedRectangle) -> some View {
        shape.strokeBorder(
            LinearGradient(colors: [Color.white.opacity(0.55), Color.white.opacity(0.06),
                                    Color.white.opacity(0.0), Color.white.opacity(0.22)],
                           startPoint: .topLeading, endPoint: .bottomTrailing),
            lineWidth: 1)
            .allowsHitTesting(false)
    }
}
