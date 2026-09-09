Attribute VB_Name = "TABReport"
Option Explicit

' ============================================================================
'  a2b TAB Report – report assembly macros (replaces module SyncToCPageCounts)
'
'  Import once per template copy:  Alt+F11 > File > Import File... > TABReport.bas
'  then remove the old "SyncToCPageCounts" module (its entry point is kept here
'  under the same name so the ToC button keeps working).
'
'  Public entry points (Alt+F8):
'    SyncToCPageCounts  – rewrite the "page n" cells on the ToC
'    HideUnusedBlocks   – hide unit blocks / outlet rows that have no data
'    ShowAllBlocks      – undo HideUnusedBlocks
'    PrintReport        – hide unused, sync ToC, then print or PDF the report in
'                         reading order: Data page n followed by Airflow page n
'                         for RTUs, MAUs, ERVs and fans (Option A layout)
' ============================================================================

Private Const FIRST_DATA_ROW As Long = 4      ' first "System" anchor row on unit sheets
Private Const HEADER_ROWS As Long = 3         ' rows 1-3 repeat on every page

' Report section order. Each entry: sheet name(s) making up one ToC line.
Private Function ReportSections() As Variant
    Dim m(0 To 13) As Variant
    m(0) = Array(10, Array("ToC"))
    m(1) = Array(13, Array("Narrative", "Summary - New", "Summary - (E)"))
    m(2) = Array(16, Array("Building Balance"))
    m(3) = Array(19, Array("RTU Data", "RTU Airflow"))
    m(4) = Array(22, Array("MAU Data", "MAU Airflow", "MAU Supply Methods"))
    m(5) = Array(25, Array("ERV Data", "ERV Airflow"))
    m(6) = Array(28, Array("Fan Data", "Fan Airflow", "VAV Data", "VAV 1-20 Airflow"))
    m(7) = Array(31, Array("Hoods"))
    m(8) = Array(34, Array("Traverses"))
    m(9) = Array(37, Array("Certification", "NEBB Cert", "NEBB Frm Cert"))
    m(10) = Array(40, Array("Abbreviations"))
    m(11) = Array(43, Array("Calibration"))
    m(12) = Array(46, Array())                ' Mechanical Floorplan(s) – external
    m(13) = Array(49, Array("Photos"))
    ReportSections = m
End Function

' Sheet pairs printed alternately (Data page n, Airflow page n).
Private Function PairedSheets() As Variant
    PairedSheets = Array(Array("RTU Data", "RTU Airflow"), Array("MAU Data", "MAU Airflow"), _
                         Array("ERV Data", "ERV Airflow"), Array("Fan Data", "Fan Airflow"))
End Function

' ---------------------------------------------------------------------------
Private Function FindSheet(ByVal wb As Workbook, ByVal label As String) As Worksheet
    Dim s As Worksheet, target As String
    target = LCase$(Trim$(label))
    For Each s In wb.Worksheets
        If LCase$(Trim$(s.Name)) = target Then Set FindSheet = s: Exit Function
    Next s
    For Each s In wb.Worksheets
        If Left$(LCase$(Trim$(s.Name)), Len(target)) = target Then Set FindSheet = s: Exit Function
    Next s
    Set FindSheet = Nothing
End Function

Private Function CountPrintPages(ByVal sh As Worksheet) As Long
    If sh.Visible <> xlSheetVisible Then CountPrintPages = 0: Exit Function
    Dim saved As Object: Set saved = ActiveSheet
    Application.ScreenUpdating = False
    sh.Activate
    Dim pages As Long
    On Error Resume Next
    pages = ExecuteExcel4Macro("GET.DOCUMENT(50)")
    On Error GoTo 0
    If pages < 1 Then pages = 1
    If Not saved Is Nothing Then saved.Activate
    Application.ScreenUpdating = True
    CountPrintPages = pages
End Function

' Anchor rows of the unit blocks on a sheet ("System" in column B).
Private Function BlockAnchors(ByVal sh As Worksheet) As Collection
    Dim c As Collection: Set c = New Collection
    Dim r As Long, last As Long
    last = sh.Cells(sh.Rows.Count, "B").End(xlUp).Row
    For r = FIRST_DATA_ROW To last
        If sh.Cells(r, "B").Value = "System" Then c.Add r
    Next r
    Set BlockAnchors = c
End Function

' A block is "used" when its System cell shows a designation.
Private Function BlockUsed(ByVal sh As Worksheet, ByVal anchor As Long) As Boolean
    BlockUsed = Len(Trim$(CStr(sh.Cells(anchor, "D").Value))) > 0
End Function

' ---------------------------------------------------------------------------
Public Sub HideUnusedBlocks()
    Dim wb As Workbook: Set wb = ThisWorkbook
    Dim names As Variant, nm As Variant, sh As Worksheet
    Dim anchors As Collection, i As Long, a As Long, nextA As Long, lastUsed As Long
    Application.ScreenUpdating = False
    names = Array("RTU Data", "RTU Airflow", "MAU Data", "MAU Airflow", "MAU Supply Methods", "ERV Data", "ERV Airflow", _
                  "Fan Data", "Fan Airflow", "VAV Data", "VAV 1-20 Airflow", "Hoods")
    For Each nm In names
        Set sh = FindSheet(wb, CStr(nm))
        If Not sh Is Nothing Then
            sh.Rows.Hidden = False
            Set anchors = BlockAnchors(sh)
            lastUsed = 0
            For i = 1 To anchors.Count
                If BlockUsed(sh, anchors(i)) Then lastUsed = i
            Next i
            If lastUsed = 0 Then lastUsed = 1
            ' hide every block after the last used one (keeps the page layout of used blocks intact)
            If lastUsed < anchors.Count Then
                a = anchors(lastUsed + 1)
                sh.Rows(a & ":" & sh.UsedRange.Rows.Count + sh.UsedRange.Row).Hidden = True
                sh.PageSetup.PrintArea = "$A$1:$N$" & (a - 1)
            End If
            ' hide empty outlet / filter rows inside used blocks (airflow sheets and hoods only)
            If InStr(1, CStr(nm), "Airflow") > 0 Or CStr(nm) = "Hoods" Then
                For i = 1 To lastUsed
                    a = anchors(i)
                    If i < anchors.Count Then nextA = anchors(i + 1) Else nextA = a + 21
                    HideEmptyTableRows sh, a, nextA - 1
                Next i
            End If
        End If
    Next nm
    ' Traverses: hide traverse blocks with no point designation
    Set sh = FindSheet(wb, "Traverses")
    If Not sh Is Nothing Then
        sh.Rows.Hidden = False
        Dim r As Long, last As Long
        last = sh.Cells(sh.Rows.Count, "B").End(xlUp).Row
        For r = FIRST_DATA_ROW To last
            If sh.Cells(r, "B").Value = "Airflow Traverse Measurement" Then
                If Len(Trim$(CStr(sh.Cells(r + 2, "B").Value))) = 0 Then sh.Rows(r & ":" & r + 5).Hidden = True
            End If
        Next r
    End If
    ' Building Balance: hide unit rows with no designation
    Set sh = FindSheet(wb, "Building Balance")
    If Not sh Is Nothing Then
        For r = 7 To 66
            sh.Rows(r).Hidden = (Len(Trim$(CStr(sh.Cells(r, "B").Value))) = 0 And Len(Trim$(CStr(sh.Cells(r, "H").Value))) = 0)
        Next r
    End If
    Application.ScreenUpdating = True
End Sub

' Hide outlet rows (No. and Area Served blank, no velocity) between the table header and the Total row.
Private Sub HideEmptyTableRows(ByVal sh As Worksheet, ByVal firstRow As Long, ByVal lastRow As Long)
    Dim r As Long, inTable As Boolean
    inTable = False
    For r = firstRow To lastRow
        If sh.Cells(r, "B").Value = "No." Then
            inTable = True
        ElseIf sh.Cells(r, "C").Value = "Total" Or sh.Cells(r, "B").Value = "Remarks" Or sh.Cells(r, "B").Value = "Notes" Then
            inTable = False
        ElseIf inTable Then
            If IsEmpty(sh.Cells(r, "B")) And IsEmpty(sh.Cells(r, "C")) And IsEmpty(sh.Cells(r, "I")) And IsEmpty(sh.Cells(r, "K")) Then
                ' keep at least the first row of every table visible
                If Not (sh.Cells(r - 1, "B").Value = "No.") Then sh.Rows(r).Hidden = True
            End If
        End If
        If sh.Name = "Hoods" Then
            ' hood filter rows: column I = filter size
            If r >= firstRow + 6 And r <= firstRow + 19 Then
                If IsEmpty(sh.Cells(r, "I")) And r > firstRow + 6 Then sh.Rows(r).Hidden = True
            End If
        End If
    Next r
End Sub

Public Sub ShowAllBlocks()
    Dim sh As Worksheet
    For Each sh In ThisWorkbook.Worksheets
        If sh.Visible = xlSheetVisible Then sh.Rows.Hidden = False
    Next sh
End Sub

' ---------------------------------------------------------------------------
Public Sub SyncToCPageCounts()
    Dim wb As Workbook: Set wb = ThisWorkbook
    Dim toc As Worksheet: Set toc = FindSheet(wb, "ToC")
    If toc Is Nothing Then MsgBox "Sheet 'ToC' not found.", vbExclamation: Exit Sub
    Dim savedCalc As Long: savedCalc = Application.Calculation
    Application.Calculation = xlCalculationManual
    Application.ScreenUpdating = False
    Dim cumulative As Long, sections As Variant, entry As Variant, sheetNames As Variant
    Dim i As Long, j As Long, sh As Worksheet, missing As String, startPage As Long
    Set sh = FindSheet(wb, "Cover Page")
    If Not sh Is Nothing Then cumulative = CountPrintPages(sh)
    sections = ReportSections()
    For i = LBound(sections) To UBound(sections)
        entry = sections(i): sheetNames = entry(1): startPage = cumulative + 1
        If IsArray(sheetNames) Then
            For j = LBound(sheetNames) To UBound(sheetNames)
                Set sh = FindSheet(wb, CStr(sheetNames(j)))
                If sh Is Nothing Then
                    missing = missing & "  - row " & entry(0) & ": " & sheetNames(j) & vbCrLf
                Else
                    cumulative = cumulative + CountPrintPages(sh)
                End If
            Next j
        End If
        toc.Range("K" & CLng(entry(0))).Value = "page " & startPage
    Next i
    Application.ScreenUpdating = True
    Application.Calculation = savedCalc
    Application.Calculate
    If Len(missing) > 0 Then MsgBox "ToC updated; sheets not found:" & vbCrLf & missing, vbInformation
End Sub

' ---------------------------------------------------------------------------
' PrintReport: Data page n / Airflow page n interleaved for each paired type.
' Prints to the active printer, or exports one PDF when toPdf = True.
Public Sub PrintReport()
    Dim answer As VbMsgBoxResult
    answer = MsgBox("Hide unused blocks and update the ToC, then export the report as PDF?" & vbCrLf & _
                    "(No = send to printer, Cancel = abort)", vbYesNoCancel + vbQuestion, "Print TAB Report")
    If answer = vbCancel Then Exit Sub
    HideUnusedBlocks
    SyncToCPageCounts
    Dim order As Collection: Set order = ReadingOrder()
    If answer = vbYes Then
        ExportPdf order
    Else
        Dim item As Variant
        For Each item In order
            PrintPage item(0), CLng(item(1))
        Next item
    End If
End Sub

' Build the print order as (sheet, page-index) pairs: whole sheets for single
' sections, page-by-page interleave for Data/Airflow pairs.
Private Function ReadingOrder() As Collection
    Dim wb As Workbook: Set wb = ThisWorkbook
    Dim c As Collection: Set c = New Collection
    Dim sections As Variant, entry As Variant, sheetNames As Variant, i As Long, j As Long, p As Long
    Dim sh As Worksheet, pair As Variant, pairs As Variant, handled As Boolean, k As Long
    Dim d As Worksheet, a As Worksheet, nd As Long, na As Long
    pairs = PairedSheets()
    Set sh = FindSheet(wb, "Cover Page")
    If Not sh Is Nothing Then c.Add Array(sh.Name, 0)
    sections = ReportSections()
    For i = LBound(sections) To UBound(sections)
        entry = sections(i): sheetNames = entry(1)
        If IsArray(sheetNames) Then
            j = LBound(sheetNames)
            Do While j <= UBound(sheetNames)
                handled = False
                For k = LBound(pairs) To UBound(pairs)
                    pair = pairs(k)
                    If LCase$(Left$(CStr(sheetNames(j)), Len(pair(0)))) = LCase$(pair(0)) And j < UBound(sheetNames) Then
                        Set d = FindSheet(wb, CStr(sheetNames(j))): Set a = FindSheet(wb, CStr(sheetNames(j + 1)))
                        If Not d Is Nothing And Not a Is Nothing Then
                            nd = CountPrintPages(d): na = CountPrintPages(a)
                            For p = 1 To IIf(nd > na, nd, na)
                                If p <= nd Then c.Add Array(d.Name, p)
                                If p <= na Then c.Add Array(a.Name, p)
                            Next p
                            j = j + 2: handled = True: Exit For
                        End If
                    End If
                Next k
                If Not handled Then
                    Set sh = FindSheet(wb, CStr(sheetNames(j)))
                    If Not sh Is Nothing Then If sh.Visible = xlSheetVisible Then c.Add Array(sh.Name, 0)
                    j = j + 1
                End If
            Loop
        End If
    Next i
    Set ReadingOrder = c
End Function

Private Sub PrintPage(ByVal sheetName As String, ByVal page As Long)
    With ThisWorkbook.Worksheets(sheetName)
        If page = 0 Then .PrintOut Else .PrintOut From:=page, To:=page
    End With
End Sub

' PDF export honours the interleaved order by printing each page to a temp
' PDF and relying on the OS PDF printer is unreliable; instead we export each
' item and let the user merge, unless the "Microsoft Print to PDF" queue is
' available. Simplest robust path: export the whole workbook in sheet order
' and note that Data/Airflow pages alternate only in the printed copy.
Private Sub ExportPdf(ByVal order As Collection)
    Dim path As String
    path = Application.GetSaveAsFilename(InitialFileName:=ThisWorkbook.Path & "\TAB Report.pdf", FileFilter:="PDF (*.pdf), *.pdf")
    If path = "False" Then Exit Sub
    Dim item As Variant, sheetNames() As String, n As Long, seen As Object
    Set seen = CreateObject("Scripting.Dictionary")
    For Each item In order
        If Not seen.Exists(item(0)) Then seen.Add item(0), True
    Next item
    ThisWorkbook.Worksheets(seen.Keys).Select
    ActiveSheet.ExportAsFixedFormat Type:=xlTypePDF, Filename:=path, Quality:=xlQualityStandard, _
        IncludeDocProperties:=True, IgnorePrintAreas:=False, OpenAfterPublish:=True
    ThisWorkbook.Worksheets(1).Select
    MsgBox "PDF written. Note: PDF export keeps sheet order (all Data pages, then all Airflow pages). " & _
           "Use PrintReport > No (printer) for the interleaved Data/Airflow order, or Option B (merged sheets).", vbInformation
End Sub
