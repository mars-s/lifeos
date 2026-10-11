import SwiftUI
import Charts

/// A keyboard alternative to dragging over a chart, using only recorded values.
struct RecordedSelectionControls<Value: Hashable>: View {
    let title: String
    let values: [Value]
    @Binding var selection: Value?
    let describe: (Value) -> String

    private var index: Int? { selection.flatMap { values.firstIndex(of: $0) } }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 16) {
                KeyboardActionButton {
                    let target = index.map { max(0, $0 - 1) } ?? max(0, values.count - 1)
                    if values.indices.contains(target) { selection = values[target] }
                } label: { Label("Previous", systemImage: "chevron.left") }
                    .disabled(values.isEmpty || index == 0)
                    .accessibilityLabel("Previous \(title)")
                KeyboardActionButton {
                    let target = index.map { min(values.count - 1, $0 + 1) } ?? 0
                    if values.indices.contains(target) { selection = values[target] }
                } label: { Label("Next", systemImage: "chevron.right") }
                    .disabled(values.isEmpty || index == values.count - 1)
                    .accessibilityLabel("Next \(title)")
            }
            Text(selection.map(describe) ?? "Choose a recorded value, or drag over the chart.")
                .foregroundStyle(desktopAccent)
                .accessibilityLabel(title)
                .accessibilityValue(selection.map(describe) ?? "No value selected")
        }
    }
}

/// Keeps native pickers reachable even when full keyboard access is off.
private struct KeyboardChoice<Value: Equatable>: ViewModifier {
    let values: [Value]
    @Binding var selection: Value
    @Environment(\.isEnabled) private var isEnabled

    func body(content: Content) -> some View {
        content.focusable()
            .onKeyPress(keys: [.leftArrow, .rightArrow, .upArrow, .downArrow]) { press in
                guard isEnabled, !values.isEmpty else { return .ignored }
                let index = values.firstIndex(of: selection) ?? 0
                let offset = [.leftArrow, .upArrow].contains(press.key) ? -1 : 1
                selection = values[min(max(index + offset, 0), values.count - 1)]
                return .handled
            }
    }
}

extension View {
    func recordedChartGesture() -> some View {
        chartGesture { proxy in
            DragGesture(minimumDistance: 0)
                .onChanged { proxy.selectXValue(at: $0.location.x) }
        }
    }

    func keyboardChoice<Value: Equatable>(_ values: [Value], selection: Binding<Value>) -> some View {
        modifier(KeyboardChoice(values: values, selection: selection))
    }
}
